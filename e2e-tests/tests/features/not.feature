
Feature: Not

Scenario: Not seeing the text

    Backgrounds: int/web-server
    serve files at "/static" from "not"
    webserver is listening for "not"
    compose page with {Web Server}/static/page.html
    go to the page webpage
    wait for "Test Page"
    using timeout of 100ms
    not wait for "Upload form"