
Feature: Upload-verify

Scenario: Upload a file, then download it and verify it's the same file

Backgrounds: int/upload-form
    serve files at /static from "upload"
    start upload route at "/upload"
    start download route at "/download"

    go to the form webpage
    upload file "files/picture.jpg" using upload chooser
    click "Upload"

    see "Uploaded file"
    expect a download
    click "Uploaded file" by text
    create directory at "tmp"
    list files from "tmp"
    receive download as "tmp/test-downloaded.jpg"
    Then "files/picture.jpg" is the same as "tmp/test-downloaded.jpg"
    list files from "tmp"
