Feature: Auth-bearer Authentication
    Set Resource Server to http://localhost:8123
    Set Profile Path to "/me"
    Set Token Path to "/token"
    Set Resources Path to "/api/resources"
    Set Resource Path to "/api/resource/"
    Combine Resource Path and "/:id" to Resource Delete Route
    Combine Resource Server and "/static/rest.html" to REST Home
    Set Logout Path to "/logout"

    Start check auth route at Profile Path
    Start create auth token route at Token Path
    Start logout auth route at Logout Path
    Start auth resources get route at Resources Path
    Start auth resource get route at Resource Path
    Start auth resource delete route at Resource Delete Route

    Combine Resource Server and Token Path to Authorization Server
    Combine Resource Server and Profile Path to Profile API
    Combine Resource Server and Resources Path to Resources API
    Combine Resource Server and Resource Path to Resource API
    Combine Resource Server and Resource Delete Path to Resource Delete API
    Combine Resource Server and "/logout?post_logout_redirect_uri=http://localhost:8123/static/loggedOut" to Logout

    Set OK to 200
    Set Unauthorized to 401

    Serve files at /static from "rest"
    Make auth scheme bearer
    API user agent is "curl/8.5.0"

    Scenario: Fail authentication 
        Go to the REST Home webpage
        Make an HTTP GET to Profile API
        HTTP status is Unauthorized
        pause for 1s

    Scenario: Fail authentication with browser user agent
        API user agent is "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        Make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Check pre-existing authentication token
        API user agent is "curl/8.5.0"
        Set testtoken to "test-token"
        Change server auth token to testtoken
        Use Authorization Bearer header with testtoken
        Make an HTTP GET to Profile API
        HTTP status is OK
        pause for 1s

    Scenario: Create authentication token
        Request OAuth 2.0 access token from Authorization Server
        HTTP status is OK
        HTTP response property "access_token" is "newToken"
        Make an HTTP GET to Profile API
        HTTP status is OK

    Scenario: Logout authentication token
        Perform OAuth 2.0 logout from Logout
        Make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Resources only accept application/json
        Request OAuth 2.0 access token from Authorization Server
        HTTP status is OK
        Make an HTTP GET to Resources API
        HTTP status is Unauthorized

    Scenario: Filter list of resources
        Request OAuth 2.0 access token from Authorization Server
        HTTP status is OK
        Accept application/json using HTTP GET to Resources API
        HTTP status is OK
        show JSON response count
        JSON response length is 3
        Filter JSON response by "name" matching "Include"
        Filtered response length is 2
        For each filtered id, make REST DELETE to Resource API yielding status 204
        Accept application/json using HTTP GET to Resources API
        JSON response length is 1
