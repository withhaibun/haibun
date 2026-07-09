Feature: Auth-apikey-jwt Authentication
    set Resource Server to http://localhost:8123
    set Profile Path to "/me"
    compose REST Home with {Resource Server}/static/rest.html

    start check auth route at Profile Path
    compose Profile API with {Resource Server}{Profile Path}

    set OK to 200
    set Unauthorized to 401

    set Tenant Id to "tenant-1"
    set Api Key to "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    set Wrong Api Key to "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

    serve files at /static from "rest"
    webserver is listening for "auth-apikey-jwt"
    make auth scheme "apiKeyJwt"
    API user agent is "curl/8.5.0"

    Scenario: Fail authentication with no auth header
        go to the REST Home webpage
        make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Fail authentication with wrong API key
        use Authorization API Key JWT header with Tenant Id, Wrong Api Key for "GET" to Profile API
        make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Pass authentication
        use Authorization API Key JWT header with Tenant Id, Api Key for "GET" to Profile API
        make an HTTP GET to Profile API
        HTTP status is OK

    Scenario: Reject a replayed token
        use Authorization API Key JWT header with Tenant Id, Api Key for "GET" to Profile API
        make an HTTP GET to Profile API
        HTTP status is OK
        make an HTTP GET to Profile API
        HTTP status is Unauthorized
