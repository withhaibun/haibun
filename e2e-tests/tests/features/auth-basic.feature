Feature: Auth-basic Authentication

    Set Resource Server to http://localhost:8123
    Set Resources Path to "/api/resources"
    Set Resource Path to "/api/resource"
    Combine Resource Server and Resources Path to Resources API
    Set Profile Path to "/me"
    Combine Resource Path and "/:id" to Resource Delete Route
    Combine Resource Server and "/static/rest.html" to REST Home

    Start check auth route at Profile Path
    Start auth resources get route at Resources Path
    Start auth resource get route at Resource Path
    Start auth resource delete route at Resource Delete Route

    Combine Resource Server and Profile Path to Profile API
    Combine Resource Server and Resource Path to Resource API

    Set OK to 200
    Set Unauthorized to 401

    Serve files at /static from "rest"
    Make auth scheme basic
    API user agent is "curl/8.5.0"

    Scenario: Fail authentication 
        Go to the REST Home webpage

        Make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Fail authentication with browser user agent
        API user agent is "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        Make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Pass authentication
        API user agent is "curl/8.5.0"
        use Authorization Basic header with foo, bar
        Go to the REST Home webpage
        Make an HTTP GET to Profile API
        HTTP status is OK

    Scenario: Resources only accept application/json
        Make an HTTP GET to Resources API
        HTTP status is Unauthorized

    Scenario: Filter list of resources
        Accept application/json using HTTP GET to Resources API
        HTTP status is OK
        show JSON response count
        JSON response length is 3
        Filter JSON response by "name" matching "Include"
        Filtered response length is 2
        For each filtered id, make REST DELETE to Resource API yielding status 204
        Accept application/json using HTTP GET to Resources API
        JSON response length is 1
