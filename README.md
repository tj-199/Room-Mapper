# Room Mapper Pro

Room Mapper Pro is a lightweight, offline-capable Progressive Web App (PWA) designed to bridge the gap between physical on-site measurements and CAD-ready digital drawings. 

Instead of relying solely on error-prone pixel tracing or sketching on loose paper, this tool allows you to upload a photo of a wall, visually correct the perspective, define real-world constraints via your tape measure readings, and export a mathematically perfect, 1:1 scale DXF file.

## Key Features

*   **Image Perspective Flattening:** Uses a 4-pin CSS 3D Matrix transform to visually "flatten" skewed wall photos into straight-on views.
*   **"Dimensions Over Pixels" Philosophy:** Visual rectangles map to real-world math. You establish a Master Wall origin `(0,0)`, and all features are driven by typed-in tape measure constraints.
*   **Conflict Prevention:** Detects when you've over-constrained a feature and automatically calculates theoretical *[Reference Dimensions]* based on existing constraints.
*   **Interactive Ledger:** Select, highlight, and edit the properties (Width, Height, Labels) of any feature on the fly.
*   **Robust Data Safety:** Cascading deletes ensure that removing a Window also cleanly purges any dimensions reliant on that Window.
*   **CAD Export:** Native JavaScript DXF generation exports a 1:1 scale file with `WALL`, `FEATURES`, and `DIMENSIONS` layered correctly for Autodesk Inventor, AutoCAD, or Adobe Illustrator.
*   **Zero Dependencies:** Built entirely using Vanilla HTML5, CSS, and ES6 JavaScript. No Node.js, Webpack, React, or heavy libraries required.

## Getting Started

Because the app is composed entirely of client-side Vanilla web technologies, getting started is extremely simple:

1. Clone or download this repository.
2. Open `index.html` in any modern web browser.
3. *Optional:* Host it on GitHub Pages or a basic web server to install it as an offline PWA on your mobile devices.

## Workflow Guide

1. **Upload:** Click `Upload` and select a photo of a wall.
2. **Flatten:** Drag the 4 red pins to the physical corners of the physical wall in the photo to square it up, then click `Apply Transform`.
3. **Set Wall:** Click `Set Wall`, click the top-left and bottom-right corners of the wall on the screen. Give it a label and input the real physical width and height.
4. **Add Features:** Click `Add Feature` to draw windows or outlets inside the wall.
5. **Dimension:** Click `Dimension`, click a wall line, then click a parallel feature line. Enter your physical tape-measure distance to lock the feature's specific X or Y coordinate.
6. **Export:** Click `Export DXF` to download your CAD-ready mapping!
