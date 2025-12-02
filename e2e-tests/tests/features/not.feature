
Feature: Not

Scenario: Not seeing the text

    serve files at /static from "not"
    go to the http://localhost:8123/static/page.html webpage
    wait for "Test Page"
    using timeout of 100ms
    not wait for "Upload form"