// Generate PNG icons from SVG using sharp
const fs = require('fs');
const path = require('path');

// Check if sharp is available, if not use a fallback approach
async function generateIcons() {
  try {
    const sharp = require('sharp');
    
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="28" fill="#3b82f6"/>
      <polygon points="64,20 100,40 100,80 64,100 28,80 28,40" fill="none" stroke="white" stroke-width="6" stroke-linejoin="round"/>
    </svg>`;
    
    const sizes = [16, 48, 128];
    const iconsDir = path.join(__dirname, 'icons');
    
    for (const size of sizes) {
      await sharp(Buffer.from(svgContent))
        .resize(size, size)
        .png()
        .toFile(path.join(iconsDir, `icon${size}.png`));
      console.log(`Generated icon${size}.png`);
    }
    
    console.log('All icons generated successfully!');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.log('Sharp not found. Installing...');
      const { execSync } = require('child_process');
      execSync('npm install sharp', { stdio: 'inherit' });
      console.log('Please run this script again.');
    } else {
      throw err;
    }
  }
}

generateIcons();
