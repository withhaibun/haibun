
Feature: Upload-verify

Scenario: Upload a file, then download it and verify it's the same file

Backgrounds: int/upload-form
    Serve files at /static from "upload"
    Start upload route at "/upload"
    Start download route at "/download"

    Go to the form webpage
    Upload file "files/picture.jpg" using upload chooser
    Click "Upload"

    See "Uploaded file"
    Expect a download
    Click "Uploaded file" by text
    create directory at tmp
    list files from tmp
    Receive download as "tmp/test-downloaded.jpg"
    Then "files/picture.jpg" is the same as "tmp/test-downloaded.jpg"
    list files from tmp
