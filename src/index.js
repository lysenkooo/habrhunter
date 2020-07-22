const puppeteer = require('puppeteer')
const fs = require('fs').promises
const path = require('path').promises
require('dotenv').config()

const imagesEnabled = true
const login = process.env.LOGIN;
const password = process.env.PASSWORD;

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 5,
    // devtools: true
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  await page.setRequestInterception(true)

  page.on('request', request => {
    if (!imagesEnabled && request.resourceType() === 'image')
      request.abort()
    else
      request.continue()
  })

  // login
  const fileExists = await fs.stat('./cookies.json').catch(e => false)
  const cookiesString = fileExists ? await fs.readFile('./cookies.json') : null

  if (cookiesString) {
    const cookies = JSON.parse(cookiesString)
    await page.setCookie(...cookies)
  } else {
    await page.goto('https://career.habr.com/users/sign_in', { waitUntil: 'networkidle2' })
    await page.type('input[name="user[email]"]', login)
    await page.type('input[name="user[password]"]', password)
    await page.click('.auth-layout__content form .buttons_wide .button')
    await page.waitForSelector('.user_panel__company-name--dropdown-label', { timeout: 5000 })

    const cookies = await page.cookies()
    await fs.writeFile('./cookies.json', JSON.stringify(cookies, null, 2))
  }

  // collect links
  const linksExists = await fs.stat('./links.json').catch(e => false)
  let links = linksExists ? JSON.parse(await fs.readFile('./links.json')) : []

  if (links.length === 0) {
    await page.goto('https://career.habr.com/resumes?skills%5B%5D=1080&currency=rur&remote=1&visit_last_year=1', { waitUntil: 'networkidle2' })

    while (true) {
      await page.waitForSelector('.search_item', { timeout: 5000 })

      const anchors = await page.$$('.search_item .username a')

      const propertyJsHandles = await Promise.all(
        anchors.map(handle => handle.getProperty('href'))
      )

      const hrefs = await Promise.all(
        propertyJsHandles.map(handle => handle.jsonValue())
      )

      links = links.concat(hrefs)
      await page.waitFor(1000 + Math.random() * 1000)

      try {
        await page.click('a[rel="next"]')
      } catch (e) {
        break
      }
    }

    await fs.writeFile('./links.json', JSON.stringify(links, null, 2))
  }

  for (const link of links) {
    console.log(link)

    const pieces = link.split('/')
    const name = pieces.pop()
    const url = `https://career.habr.com/conversations/${name}`

    await page.goto(url, { waitUntil: 'networkidle2' })

    try {
      await page.waitForSelector('.templates_popup_toggle_wrapper', { timeout: 5000 })

      if (await page.$('.messages .empty') !== null) {
        await page.click('.templates_popup_toggle_wrapper .toggler')
        await page.click('.templates_popup_wrapper li')
        await page.click('.new_message button')
      }
    } catch (e) {
      console.log(e)
    }

    await page.waitFor(1000 + Math.random() * 1000)
  }

  await browser.close()
})()
