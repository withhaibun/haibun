Scenario: Generate and clear a QR code
  backgrounds: int/qrcode

  This will serve the local qrcode static files and exercise the UI.

  serve files at /static from "qrcode"
  
  Go to the qrcode URI webpage
  wait for "QR Code Generator"

  canvas "canvas" is empty

  click "Draw QR Code"

  not canvas "canvas" is empty

  click "Clear QR Code"

  canvas "canvas" is empty

  input "hmm hmm" for label

  click "Draw QR Code"

  not canvas "canvas" is empty
  