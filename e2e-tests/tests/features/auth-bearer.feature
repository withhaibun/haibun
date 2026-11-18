Feature: Auth-bearer Authentication
    Backgrounds: int/web-server
    set Resource Server to Web Server
    set Profile Path to "/me"
    set Token Path to "/token"
    set Resources Path to "/api/resources"
    set Resource Path to "/api/resource"
    compose Resource Delete Route with {Resource Path}/:id
    compose REST Home with {Resource Server}/static/rest.html
    set Logout Path to "/logout"

    start check auth route at Profile Path
    start create auth token route at Token Path
    start logout auth route at Logout Path
    start auth resources get route at Resources Path
    start auth resource get route at Resource Path
    start auth resource delete route at Resource Delete Route

    compose Authorization Server with {Resource Server}{Token Path}
    compose Profile API with {Resource Server}{Profile Path}
    compose Resources API with {Resource Server}{Resources Path}
    compose Resource API with {Resource Server}{Resource Path}
    compose Resource Delete API with {Resource Server}{Resource Delete Route}
    compose Logout with {Resource Server}/logout?post_logout_redirect_uri={Web Server}/static/loggedOut

    set OK to 200
    set Unauthorized to 401
    set Bad Request to 400

    serve files at "/static" from "rest"
    webserver is listening for "auth-bearer"
    make auth scheme "bearer"
    API user agent is "curl/8.5.0"


    A resource is deleted at the address its id names under the resource route, whose response is empty.
    Activity: Delete the resource
    compose Deleted Resource with {Resource API}/{resource.id}
    set deleted response from make an HTTP DELETE to Deleted Resource
    variable deleted response.status is 204
    waypoint the resource is deleted
    Scenario: Fail authentication without an auth header
        go to the REST Home webpage
        # RFC 6750: missing Authorization header -> 401 Unauthorized
        set profile response from make an HTTP GET to Profile API
        variable profile response.status is Unauthorized

    Scenario: Fail authentication with browser user agent
        API user agent is "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        set profile response from make an HTTP GET to Profile API
        variable profile response.status is Unauthorized

    Scenario: Check pre-existing authentication token
        API user agent is "curl/8.5.0"
        set testtoken to "test-token"
        change server auth token to testtoken
        use Authorization Bearer header with testtoken
        set profile response from make an HTTP GET to Profile API
        variable profile response.status is OK

    Scenario: Create authentication token
        set token response from request OAuth 2.0 access token from Authorization Server
        variable token response.status is OK
        variable token response.json.access_token is "newToken"
        set profile response from make an HTTP GET to Profile API
        variable profile response.status is OK

    Scenario: Logout authentication token
        perform OAuth 2.0 logout from Logout
        set profile response from make an HTTP GET to Profile API
        variable profile response.status is Unauthorized

    Scenario: Resources only accept application/json
        set token response from request OAuth 2.0 access token from Authorization Server
        variable token response.status is OK
        set resources response from make an HTTP GET to Resources API
        variable resources response.status is Unauthorized
        variable resources response.text is "Must use application/json, not */*"

    Scenario: filter list of resources
        set token response from request OAuth 2.0 access token from Authorization Server
        variable token response.status is OK
        set list response from accept "application/json" using HTTP GET to Resources API
        variable list response.status is OK
        exactly 3, show JSON response of list response.json
        exactly 2, whose "name" matches "Include", show JSON response of list response.json
        for each resource of whose "name" matches "Include", show JSON response of list response.json: the resource is deleted
        set second response from accept "application/json" using HTTP GET to Resources API
        exactly 1, show JSON response of second response.json
