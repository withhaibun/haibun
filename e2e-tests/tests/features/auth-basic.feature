Feature: Auth-basic Authentication

    Backgrounds: int/web-server
    set Resource Server to Web Server
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

    serve files at "/static" from "rest"
    webserver is listening for "auth-basic"
    make auth scheme "basic"
    API user agent is "curl/8.5.0"


    A resource is deleted at the address its id names under the resource route, whose response is empty.
    Activity: Delete the resource
    compose Deleted Resource with {Resource API}/{resource/id}
    make an HTTP DELETE to Deleted Resource
    HTTP status is 204
    waypoint the resource is deleted
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
        use Authorization Basic header with "foo:bar"
        go to the REST Home webpage
        make an HTTP GET to Profile API
        HTTP status is OK

    Scenario: Resources only accept application/json
        make an HTTP GET to Resources API
        HTTP status is Unauthorized

    Scenario: filter list of resources
        accept "application/json" using HTTP GET to Resources API
        HTTP status is OK
        exactly 3, show JSON response
        exactly 2, whose "name" matches "Include", show JSON response
        for each resource of whose "name" matches "Include", show JSON response: the resource is deleted
        accept "application/json" using HTTP GET to Resources API
        exactly 1, show JSON response
