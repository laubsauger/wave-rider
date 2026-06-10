import puppeteer from 'puppeteer'

async function run() {
  console.log('Launching browser...')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=vulkan']
  })

  try {
    console.log('Opening Host Tab...')
    const hostPage = await browser.newPage()
    hostPage.on('console', msg => console.log('HOST CONSOLE:', msg.text()))
    hostPage.on('pageerror', err => console.log('HOST PAGE ERROR:', err.message))
    
    await hostPage.goto('http://localhost:5176/', { waitUntil: 'networkidle2' })
    
    // Check if the "HOST MULTIPLAYER" button is available
    await hostPage.waitForSelector('button')
    
    // Click the "HOST MULTIPLAYER" button (which is in the Menu)
    const hostBtn = await hostPage.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      return btns.find(b => b.textContent?.includes('MULTIPLAYER'))
    })
    
    if (!hostBtn) throw new Error("Host button not found")
    await hostBtn.click()

    // Now wait for the lobby to generate the share link
    console.log('Waiting for Lobby share link...')
    await hostPage.waitForFunction(() => {
      return document.body.innerText.includes('waiting for opponent') || document.body.innerText.includes('SHARE THIS LINK')
    })

    // Extract the URL to join
    const joinUrl = await hostPage.evaluate(() => {
      // Find the input field or text containing the URL
      const inputs = Array.from(document.querySelectorAll('input'))
      const linkInput = inputs.find(i => i.value.includes('?join='))
      if (linkInput) return linkInput.value
      // Fallback
      return window.location.href
    })
    
    console.log('Host created lobby:', joinUrl)

    if (!joinUrl || !joinUrl.includes('?join=')) {
      throw new Error("Could not find join URL in host page")
    }

    console.log('Opening Join Tab...')
    const joinPage = await browser.newPage()
    await joinPage.goto(joinUrl, { waitUntil: 'networkidle2' })

    console.log('Waiting for connection to establish...')
    // The lobby should transition when a player joins
    // Let's monitor the console logs to see connection events
    joinPage.on('console', msg => console.log('JOIN LOG:', msg.text()))
    hostPage.on('console', msg => console.log('HOST LOG:', msg.text()))

    await new Promise(resolve => setTimeout(resolve, 5000))

    // Check if the state changed to "CONNECTED" or if the game started
    const hostText = await hostPage.evaluate(() => document.body.innerText)
    const joinText = await joinPage.evaluate(() => document.body.innerText)

    console.log('--- HOST TEXT ---')
    console.log(hostText.slice(0, 500))
    console.log('--- JOIN TEXT ---')
    console.log(joinText.slice(0, 500))

    if (hostText.includes('OPPONENT JOINED') || hostText.includes('START RACE') || hostText.includes('CONNECTED')) {
      console.log('SUCCESS: Host recognized the opponent!')
    } else {
      console.log('FAILURE: Host did not recognize the connection.')
    }
  } catch (err) {
    const html = await browser.pages().then(pages => pages[0].evaluate(() => document.body.innerText)).catch(() => 'no page')
    console.error('Test failed:', err.message)
    console.error('PAGE TEXT:', html)
  } finally {
    await browser.close()
  }
}

run()
