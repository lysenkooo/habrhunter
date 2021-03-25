const puppeteer = require('puppeteer')
const fs = require('fs').promises
const path = require('path').promises
require('dotenv').config()


const WAIT_TIMEOUT = 5000
const IMAGES_ENABLED = true
const ACTION_COLLECT = 'collect'
const ACTION_SPAM = 'spam'
const AVAILABLE_ACTIONS = [ACTION_COLLECT, ACTION_SPAM]

const USER_LOGIN = process.env.LOGIN
const USER_PASSWORD = process.env.PASSWORD
const ACTION = process.env.ACTION
const FORCE = process.env.FORCE
const FILENAME = process.env.FILENAME
const RESUME_LIST = process.env.RESUME_LIST

if (!AVAILABLE_ACTIONS.includes(ACTION)) {
  console.error('Unknown action', ACTION)
  process.exit(1)
}

if (!FILENAME) {
  console.error('Unknown filename')
  process.exit(1)
}

console.log('Using file', FILENAME)

async function initPage(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  await page.setRequestInterception(true)

  page.on('request', request => {
    if (!IMAGES_ENABLED && request.resourceType() === 'image') {
      request.abort()
    } else {
      request.continue()
    }
  })

  await login(page)

  return page
}

async function login(page) {
  const fileExists = await fs.stat('./tmp/cookies.json').catch(e => false)
  const cookiesString = fileExists ? await fs.readFile('./tmp/cookies.json') : null

  if (cookiesString) {
    const cookies = JSON.parse(cookiesString)
    await page.setCookie(...cookies)
  } else {
    await page.goto('https://career.habr.com/users/sign_in', { waitUntil: 'networkidle2' })
    await page.type('input[name="user[email]"]', USER_LOGIN)
    await page.type('input[name="user[password]"]', USER_PASSWORD)
    await page.click('.auth-layout__content form .buttons_wide .button')
    await page.waitForSelector('.user_panel__item.user_panel__mail', { timeout: WAIT_TIMEOUT })

    const cookies = await page.cookies()
    await fs.writeFile('./tmp/cookies.json', JSON.stringify(cookies, null, 2))
  }
}

async function loadLinks() {
  const linksExists = await fs.stat(`./tmp/${FILENAME}.json`).catch(e => false)

  return linksExists ? JSON.parse(await fs.readFile(`./tmp/${FILENAME}.json`)) : []
}

async function saveLinks(links) {
  return await fs.writeFile(`./tmp/${FILENAME}.json`, JSON.stringify(links, null, 2))
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 5,
    // devtools: true
  })

  process.on('SIGINT', async () => {
    console.log('Caught interrupt signal')
    await browser.close()
    process.exit()
  })

  try {
    const page = await initPage(browser)

    if (ACTION === ACTION_COLLECT) {
      if (!RESUME_LIST) {
        console.error('Bad resume list url')
        process.exit(1)
      }

      let links = FORCE ? [] : await loadLinks()

      if (links.length > 0) {
        console.log('Links exist, please use force mode...')
      } else {
        await page.goto(RESUME_LIST, { waitUntil: 'networkidle2' })

        while (true) {
          console.log('Loading...')
          const resumeLinkSelector = '.with-pagination .section-group .basic-section .resume-card .resume-card__title .resume-card__title-link'
          await page.waitForSelector(resumeLinkSelector, { timeout: WAIT_TIMEOUT })
          const anchors = await page.$$(resumeLinkSelector)

          const propertyJsHandles = await Promise.all(
            anchors.map(handle => handle.getProperty('href'))
          )

          const hrefs = await Promise.all(
            propertyJsHandles.map(handle => handle.jsonValue())
          )

          console.log(hrefs)

          links = links.concat(hrefs)
          await saveLinks(links)

          try {
            console.log('Click next...')
            await page.click('.with-pagination__controls a[rel="next"]')
            await page.waitFor(1000 + Math.random() * 1000)
            await page.waitForSelector('.with-pagination .basic-section .resume-card-skeleton', { timeout: WAIT_TIMEOUT, hidden: true })
          } catch (e) {
            console.log('Error during click next...')
            break
          }
        }

        console.log('Finished!')
      }
    } else if (ACTION === ACTION_SPAM) {
      const links = await loadLinks()

      while (links.length > 0) {
        await page.waitFor(1000 + Math.random() * 1000)

        const link = links.shift()
        const pieces = link.split('/')
        const name = pieces.pop()
        const url = `https://career.habr.com/conversations/${name}`
        console.log('Load', url)

        let response, status, chain

        try {
          response = await page.goto(url, { waitUntil: 'networkidle2' })
          status = response.status()
          chain = response.request().redirectChain()
        } catch (e) {
          console.log('Can not load the page')
        }

        if (!response) {
          console.log('Return link back')
          links.unshift(link)
        } else if (chain.length > 0) {
          console.log('Redirect found, gonna skip:', name)
          links.push(link)
        } else if (status === 404) {
          console.log('User not found, remove it:', name)
        } else {
          try {
            await page.waitForSelector('.chat-footer__write-footer', { timeout: WAIT_TIMEOUT })

            const emptyHistoryPlaceholder = await page.$('chat__body chat--placeholder')
            const [vacancyBody] = await page.$x("//div[@class='chat__messages-container']/div[contains(., '1000061701')]")

            if (emptyHistoryPlaceholder || !vacancyBody) {
              await page.click('.chat-footer__rounded-button--template')
              const [templateButton] = await page.$x("//div[@class='template-modal__list']/div[contains(., '1000061701')]")
              await templateButton.click()
              await page.click('.chat-footer__rounded-button--send')
              console.log('Sent to:', name)
            } else {
              console.log('Person was already messaged:', name)
            }
          } catch (e) {
            console.log(e)
          }
        }

        await fs.writeFile(`./tmp/${FILENAME}.json`, JSON.stringify(links, null, 2))
      }
    }

    console.log('Bye!')
  } catch (e) {
    console.log('Error', e)
  } finally {
    await browser.close()
  }
})()
