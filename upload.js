const { spawn } = require("child_process");
const fs = require('fs/promises')
const { extname } = require('path')
const cheerio = require('cheerio')
const { hashElement } = require('folder-hash');
const FastlyAPI = require('node-fastly-api')
const { trim } = require('lodash')

require('dotenv').config()

const debug = false
const bucketPath = process.env.GCS_BUCKET_PATH || false
const fastlyKey = process.env.FASTLY_API_KEY || false
const fastlyServiceId = process.env.FASTLY_SERVICE_ID || false
const fastlyDictId = process.env.FASTLY_DICT_ID || false

if ( !bucketPath ) {
    console.error('missing GCS_BUCKET_PATH environment variable, have you created a .env file?')
    process.exit(1)
}

if ( !fastlyKey ) {
    console.error('missing FASTLY_API_KEY environment variable, have you created a .env file?')
    process.exit(1)
}

if ( !fastlyServiceId ) {
    console.error('missing FASTLY_SERVICE_ID')
    process.exit(1)
}

if ( !fastlyDictId ) {
    console.error('missing FASTLY_DICT_ID')
    process.exit(1)
}


function runCmd(cmd, args) {
    return new Promise(async (resolve, reject) => {
      const spawned = spawn(cmd, args);

      if ( debug ) {
        spawned.stdout.pipe(process.stdout, { end: false });
        spawned.stderr.pipe(process.stderr, { end: false });
      }
  
      spawned.on("exit", (code) => {
        if (code <= 0) {
            resolve();
        } else {
            console.error(`${cmd} exited with code ${code}`);
          reject(code);
        }
      });
    });
}

async function gatherLinks(file) {
    const links = []
    const html = await (await fs.readFile(`dist/${file}`)).toString()
    const dom = cheerio.load(html)
    dom('img', 'body').each( (i, img) => {
        links.push(img.attribs.src)
    })
    return links
}

function metaFromLinks(links) {
    let meta = ``
    links.forEach( (link) => {
        meta += `<${link}>; rel=preload; as=image, `
    })
    return trim(meta, ',')
}

(async () => {
    try {
        const folderHash = await hashElement(`dist`, {encoding: "hex"})

        const uploadFolder = folderHash.hash;

        console.log(`Uploading all files to ${bucketPath}/${uploadFolder}`)
        await runCmd(
            'gsutil',
            [
                '-m',
                'rsync',
                '-d',
                '-r',
                'dist',
                `${bucketPath}/${uploadFolder}`
            ]
        )
        console.log(`Files sync'd, parsing links and setting headers`)
        const files = await fs.readdir(`dist`)

        const all = await Promise.all(files.map( async (file) => {
            if ( extname(file) === `.html` ) {
                const links = await gatherLinks(file);
                if ( links ) {
                    const meta = metaFromLinks(links)
                    return runCmd(`gsutil`, [
                        'setmeta',
                        '-h', 
                        `x-goog-meta-link: ${meta}`,
                        `${bucketPath}/${uploadFolder}/${file}`
                    ])
                }
            }
            return Promise.resolve()
        }))
        
        console.log(`Updating Fastly config`)

        const api = FastlyAPI(fastlyKey, fastlyServiceId)

        const path = `/nullvariable/${uploadFolder}`

        await api.updateDictionaryItem(fastlyServiceId, fastlyDictId, `nullvariable.com_hash`, {
            item_value: path,
        })

        console.info(`upload complete`)

        return
    } catch (error) {
        console.error(error)
        debugger
        process.exit(1)
    }
})();