Feature: Auth-basic Authentication

    set Resource Server to http://localhost:8123
    set Resources Path to "/api/resources"
    set Resource Path to "/api/resource"
    compose Resources API with {Resource Server}{Resources Path}
    set Profile Path to "/me"
    compose Resource Delete Route with {Resource Path}/:id
    compose REST Home with {Resource Server}/static/rest.html

    start check auth route at Profile Path
    start auth resources get route at Resources Path
    start auth resource get route at Resource Path
    start auth resource delete route at Resource Delete Route

    compose Profile API with {Resource Server}{Profile Path}
    compose Resource API with {Resource Server}{Resource Path}

    set OK to 200
    set Unauthorized to 401

    serve files at /static from "rest"
    make auth scheme "basic"
    API user agent is "curl/8.5.0"

    Scenario: Fail authentication 
        go to the REST Home webpage

        make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Fail authentication with browser user agent
        API user agent is "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        make an HTTP GET to Profile API
        HTTP status is Unauthorized

    Scenario: Pass authentication
        API user agent is "curl/8.5.0"
        use Authorization Basic header with "foo", "bar"
        go to the REST Home webpage
        make an HTTP GET to Profile API
        HTTP status is OK

    Scenario: Resources only accept application/json
        make an HTTP GET to Resources API
        HTTP status is Unauthorized

    Scenario: filter list of resources
        accept application/json using HTTP GET to Resources API
        HTTP status is OK
        show JSON response count
        JSON response length is 3
        filter JSON response by "name" matching "Include"
        filtered response length is 2
        for each filtered "id", make REST DELETE to Resource API yielding status 204
        accept application/json using HTTP GET to Resources API
        JSON response length is 1
