/* eslint-disable @typescript-eslint/no-require-imports */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const svgContent = fs.readFileSync(path.join(__dirname, '../public/favicon.svg'), 'utf8')

async function generateFavicons() {
  const sizes = [16, 32, 48, 180]

  for (const size of sizes) {
    await sharp(Buffer.from(svgContent))
      .resize(size, size)
      .png()
      .toFile(path.join(__dirname, `../public/favicon-${size}x${size}.png`))
    console.log(`Generated ${size}x${size}`)
  }

  fs.copyFileSync(
    path.join(__dirname, '../public/favicon-32x32.png'),
    path.join(__dirname, '../public/favicon.png')
  )
  console.log('Done')
}

generateFavicons()
