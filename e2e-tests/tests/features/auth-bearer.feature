Feature: Auth-bearer Authentication
    set Resource Server to http://localhost:8123
    set Profile Path to "/me"
    set Token Path to "/token"
    set Resources Path to "/api/resources"
    set Resource Path to "/api/resource/"
    combine Resource Path and "/:id" to Resource Delete Route
    combine Resource Server and "/static/rest.html" to REST Home
    set Logout Path to "/logout"

    start check auth route at Profile Path
    start create auth token route at Token Path
    start logout auth route at Logout Path
    start auth resources get route at Resources Path
    start auth resource get route at Resource Path
    start auth resource delete route at Resource Delete Route

    combine Resource Server and Token Path to Authorization Server
    combine Resource Server and Profile Path to Profile API
    combine Resource Server and Resources Path to Resources API
    combine Resource Server and Resource Path to Resource API
    combine Resource Server and Resource Delete Path to Resource Delete API
    combine Resource Server and "/logout?post_logout_redirect_uri=http://localhost:8123/static/loggedOut" to Logout

    set OK to 200
    set Unauthorized to 401

    serve files at /static from "rest"
    make auth scheme bearer
    API user agent is "curl/8.5.0"

    Scenario: Fail authentication 
        go to the REST Home webpage
        make an HTTP GET to Profile API
        HTTP status is Unauthorized
        pause for 1s

    Scenario: Fail authentication with browser user agent
        API user agent is "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Check pre-existing authentication token
        API user agent is "curl/8.5.0"
        set testtoken to "test-token"
        change server auth token to testtoken
        use Authorization Bearer header with testtoken
        make an HTTP GET to Profile API
        HTTP status is OK
        pause for 1s

    Scenario: Create authentication token
        request OAuth 2.0 access token from Authorization Server
        HTTP status is OK
        HTTP response property "access_token" is "newToken"
        make an HTTP GET to Profile API
        HTTP status is OK

    Scenario: Logout authentication token
        perform OAuth 2.0 logout from Logout
        make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Resources only accept application/json
        request OAuth 2.0 access token from Authorization Server
        HTTP status is OK
        make an HTTP GET to Resources API
        HTTP status is Unauthorized

    Scenario: filter list of resources
        request OAuth 2.0 access token from Authorization Server
        HTTP status is OK
        accept application/json using HTTP GET to Resources API
        HTTP status is OK
        show JSON response count
        JSON response length is 3
        filter JSON response by "name" matching "Include"
        filtered response length is 2
        for each filtered id, make REST DELETE to Resource API yielding status 204
        accept application/json using HTTP GET to Resources API
        JSON response length is 1
