const rp = require('request-promise-native')
const parse = require('xml2js').parseString
const sequential = require('promise-sequential');
const throat = require('throat')
const config = require('./config.json')
const max = 100

function getReadUrl (base, feed) {
    return `${base}?l=${max}&n=${feed}`
}
function getWriteUrl(base, feed, url) {
    return `${base}add?n=${feed}&u=${url}`
}

let nbError = 0

function getXmlFeed (base, feed) {
    const url = getReadUrl(base, feed)
    return rp(url)
    .then(xml => {
        console.log(`< fetching ${url}`)
        return new Promise((resolve, reject) => {
            parse(xml, (err, result) => {
                if (err) return reject(err)
                return resolve(result.rss.channel && result.rss.channel.length && result.rss.channel[0].item || [])
            })
        })
    })
}

function alreadyInTarget(array, link) {
    return array.indexOf(link) !== -1
}

function cleanUrl (url) {
    return url.replace(/&?utm_.+?(&|$)/g, '')
}

sequential(config.feeds.map(feed => {
    let itemsInTarget
    return () => {
        return getXmlFeed(config.target, feed)
        .then(items => {
            itemsInTarget = items.map(item => item.link[0])
        })
        .then(() => getXmlFeed(config.source, feed))
        .then(items => {
            return items.map(item => {
                return item.link[0].replace('\n', '')
            })
        })
        .then(links => {
            return Promise.all(links.map(throat(2, rawLink => {
                const link = cleanUrl(rawLink)
                if (alreadyInTarget(itemsInTarget, link)) {
                    console.log(`= skipping link already in target : ${link}`)
                    return Promise.resolve()
                } else {
                    const url = getWriteUrl(config.target, feed, link)
                    console.log(`> sending ${url}`)
                    return rp({
                        method: 'GET',
                        uri: url,
                        resolveWithFullResponse: true,
                    })
                    .then(response => {
                        console.log(`< reponse: ${response.statusCode} - ${url}`)
                    })
                    .catch(e => {
                        nbError++
                        console.error(`< reponse: ${e} - ${url}`)
                        if (nbError > 100) throw new Error('too much errors')
                    })
                    .then(_ => {
                        return new Promise(resolve => {
                            setTimeout(resolve, 500)
                        })
                    })
                }
            })))
        })
        .catch(e => {
            console.error(e)
            process.exit(1)
        })
}}))

