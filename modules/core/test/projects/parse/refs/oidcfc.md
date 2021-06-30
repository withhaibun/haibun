Draft: OpenID Connect Front-Channel Logout 1.0 - draft 04    <!-- body { font-family: verdana, charcoal, helvetica, arial, sans-serif; font-size: small; color: #000; background-color: #FFF; margin: 2em; } h1, h2, h3, h4, h5, h6 { font-family: helvetica, monaco, "MS Sans Serif", arial, sans-serif; font-weight: bold; font-style: normal; } h1 { color: #900; background-color: transparent; text-align: right; } h3 { color: #333; background-color: transparent; } td.RFCbug { font-size: x-small; text-decoration: none; width: 30px; height: 30px; padding-top: 2px; text-align: justify; vertical-align: middle; background-color: #000; } td.RFCbug span.RFC { font-family: monaco, charcoal, geneva, "MS Sans Serif", helvetica, verdana, sans-serif; font-weight: bold; color: #666; } td.RFCbug span.hotText { font-family: charcoal, monaco, geneva, "MS Sans Serif", helvetica, verdana, sans-serif; font-weight: normal; text-align: center; color: #FFF; } table.TOCbug { width: 30px; height: 15px; } td.TOCbug { text-align: center; width: 30px; height: 15px; color: #FFF; background-color: #900; } td.TOCbug a { font-family: monaco, charcoal, geneva, "MS Sans Serif", helvetica, sans-serif; font-weight: bold; font-size: x-small; text-decoration: none; color: #FFF; background-color: transparent; } td.header { font-family: arial, helvetica, sans-serif; font-size: x-small; vertical-align: top; width: 33%; color: #FFF; background-color: #666; } td.author { font-weight: bold; font-size: x-small; margin-left: 4em; } td.author-text { font-size: x-small; } /\* info code from SantaKlauss at http://www.madaboutstyle.com/tooltip2.html \*/ a.info { /\* This is the key. \*/ position: relative; z-index: 24; text-decoration: none; } a.info:hover { z-index: 25; color: #FFF; background-color: #900; } a.info span { display: none; } a.info:hover span.info { /\* The span will display just on :hover state. \*/ display: block; position: absolute; font-size: smaller; top: 2em; left: -5em; width: 15em; padding: 2px; border: 1px solid #333; color: #900; background-color: #EEE; text-align: left; } a { font-weight: bold; } a:link { color: #900; background-color: transparent; } a:visited { color: #633; background-color: transparent; } a:active { color: #633; background-color: transparent; } p { margin-left: 2em; margin-right: 2em; } p.copyright { font-size: x-small; } p.toc { font-size: small; font-weight: bold; margin-left: 3em; } table.toc { margin: 0 0 0 3em; padding: 0; border: 0; vertical-align: text-top; } td.toc { font-size: small; font-weight: bold; vertical-align: text-top; } ol.text { margin-left: 2em; margin-right: 2em; } ul.text { margin-left: 2em; margin-right: 2em; } li { margin-left: 3em; } /\* RFC-2629 <spanx>s and <artwork>s. \*/ em { font-style: italic; } strong { font-weight: bold; } dfn { font-weight: bold; font-style: normal; } cite { font-weight: normal; font-style: normal; } tt { color: #036; } tt, pre, pre dfn, pre em, pre cite, pre span { font-family: "Courier New", Courier, monospace; font-size: small; } pre { text-align: left; padding: 4px; color: #000; background-color: #CCC; } pre dfn { color: #900; } pre em { color: #66F; background-color: #FFC; font-weight: normal; } pre .key { color: #33C; font-weight: bold; } pre .id { color: #900; } pre .str { color: #000; background-color: #CFF; } pre .val { color: #066; } pre .rep { color: #909; } pre .oth { color: #000; background-color: #FCF; } pre .err { background-color: #FCC; } /\* RFC-2629 <texttable>s. \*/ table.all, table.full, table.headers, table.none { font-size: small; text-align: center; border-width: 2px; vertical-align: top; border-collapse: collapse; } table.all, table.full { border-style: solid; border-color: black; } table.headers, table.none { border-style: none; } th { font-weight: bold; border-color: black; border-width: 2px 2px 3px 2px; } table.all th, table.full th { border-style: solid; } table.headers th { border-style: none none solid none; } table.none th { border-style: none; } table.all td { border-style: solid; border-color: #333; border-width: 1px 2px; } table.full td, table.headers td, table.none td { border-style: none; } hr { height: 1px; } hr.insert { width: 80%; border-style: none; border-width: 0; color: #CCC; background-color: #CCC; } -->

 [TOC](#toc) 

Draft

M. Jones

 

Microsoft

 

August 7, 2020

  
OpenID Connect Front-Channel Logout 1.0 - draft 04
=====================================================

### Abstract

OpenID Connect 1.0 is a simple identity layer on top of the OAuth 2.0 protocol. It enables Clients to verify the identity of the End-User based on the authentication performed by an Authorization Server, as well as to obtain basic profile information about the End-User in an interoperable and REST-like manner.

This specification defines a logout mechanism that uses front-channel communication via the User Agent between the OP and RPs being logged out that does not need an OpenID Provider iframe on Relying Party pages. Other protocols have used HTTP GETs to RP URLs that clear login state to achieve this. This specification does the same thing.

  

* * *

### Table of Contents

[1.](#Introduction)  Introduction  
    [1.1.](#rnc)  Requirements Notation and Conventions  
    [1.2.](#Terminology)  Terminology  
[2.](#RPLogout)  Relying Party Logout Functionality  
[3.](#OPLogout)  OpenID Provider Logout Functionality  
    [3.1.](#ExampleFrontchannel)  Example Front-Channel Logout URL Usage  
[4.](#ImplementationConsiderations)  Implementation Considerations  
    [4.1.](#ThirdPartyContent)  User Agents Blocking Access to Third-Party Content  
[5.](#Security)  Security Considerations  
[6.](#IANA)  IANA Considerations  
    [6.1.](#ClaimsRegistration)  JSON Web Token Claims Registration  
        [6.1.1.](#ClaimsContents)  Registry Contents  
    [6.2.](#DynRegRegistration)  OAuth Dynamic Client Registration Metadata Registration  
        [6.2.1.](#DynRegContents)  Registry Contents  
    [6.3.](#ASMetadataRegistry)  OAuth Authorization Server Metadata Registry  
        [6.3.1.](#MetadataContents)  Registry Contents  
[7.](#rfc.references1)  References  
    [7.1.](#rfc.references1)  Normative References  
    [7.2.](#rfc.references2)  Informative References  
[Appendix A.](#Acknowledgements)  Acknowledgements  
[Appendix B.](#Notices)  Notices  
[Appendix C.](#History)  Document History  
[§](#rfc.authors)  Author's Address  

  
  

* * *

 [TOC](#toc) 

### 1.  Introduction

OpenID Connect 1.0 is a simple identity layer on top of the OAuth 2.0 [\[RFC6749\] (Hardt, D., Ed., “The OAuth 2.0 Authorization Framework,” October 2012.)](#RFC6749) protocol. It enables Clients to verify the identity of the End-User based on the authentication performed by an Authorization Server, as well as to obtain basic profile information about the End-User in an interoperable and REST-like manner.

This specification defines a logout mechanism that uses front-channel communication via the User Agent between the OP and RPs being logged out that does not need an OpenID Provider iframe on Relying Party pages, as [OpenID Connect Session Management 1.0 (de Medeiros, B., Agarwal, N., Sakimura, N., Bradley, J., and M. Jones, “OpenID Connect Session Management 1.0,” August 2020.)](#OpenID.Session) \[OpenID.Session\] does. Other protocols have used HTTP GETs to RP URLs that clear login state to achieve this; this specification does the same thing.

In contrast, the [OpenID Connect Back-Channel Logout 1.0 (Jones, M. and J. Bradley, “OpenID Connect Back-Channel Logout 1.0,” August 2020.)](#OpenID.BackChannel) \[OpenID.BackChannel\] specification uses direct back-channel communication between the OP and RPs being logged out; this differs from front-channel logout mechanisms, which communicate logout requests from the OP to RPs via the User Agent. The [OpenID Connect RP-Initiated Logout 1.0 (Jones, M., de Medeiros, B., Agarwal, N., Sakimura, N., and J. Bradley, “OpenID Connect RP-Initiated Logout 1.0,” August 2020.)](#OpenID.RPInitiated) \[OpenID.RPInitiated\] specification complements these specifications by defining a mechanism for a Relying Party to request that an OpenID Provider log out the End-User.

This specification can be used separately from or in combination with OpenID Connect RP-Initiated Logout 1.0, OpenID Connect Session Management 1.0, and/or OpenID Connect Back-Channel Logout 1.0.

  

* * *

 [TOC](#toc) 

### 1.1.  Requirements Notation and Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119 (Bradner, S., “Key words for use in RFCs to Indicate Requirement Levels,” March 1997.)](#RFC2119) \[RFC2119\].

In the .txt version of this specification, values are quoted to indicate that they are to be taken literally. When using these values in protocol messages, the quotes MUST NOT be used as part of the value. In the HTML version of this specification, values to be taken literally are indicated by the use of this fixed-width font.

  

* * *

 [TOC](#toc) 

### 1.2.  Terminology

This specification uses the terms "Authorization Server", "Client", "Client Identifier", and "Redirection URI" defined by [OAuth 2.0 (Hardt, D., Ed., “The OAuth 2.0 Authorization Framework,” October 2012.)](#RFC6749) \[RFC6749\], the term "User Agent" defined by [RFC 7230 (Fielding, R., Ed. and J. Reschke, Ed., “Hypertext Transfer Protocol (HTTP/1.1): Message Syntax and Routing,” June 2014.)](#RFC7230) \[RFC7230\], and the terms defined by [OpenID Connect Core 1.0 (Sakimura, N., Bradley, J., Jones, M., de Medeiros, B., and C. Mortimore, “OpenID Connect Core 1.0,” November 2014.)](#OpenID.Core) \[OpenID.Core\].

This specification also defines the following terms:

> Session
> 
> Continuous period of time during which an End-User accesses a Relying Party relying on the Authentication of the End-User performed by the OpenID Provider.
> 
> Session ID
> 
> Identifier for a Session.

  

* * *

 [TOC](#toc) 

### 2.  Relying Party Logout Functionality

RPs supporting HTTP-based logout register a logout URI with the OP as part of their client registration. The domain, port, and scheme of this URL MUST be the same as that of a registered Redirection URI value.

The logout URI MUST be an absolute URI as defined by Section 4.3 of [\[RFC3986\] (Berners-Lee, T., Fielding, R., and L. Masinter, “Uniform Resource Identifier (URI): Generic Syntax,” January 2005.)](#RFC3986). The logout URI MAY include an application/x-www-form-urlencoded formatted query component, per Section 3.4 of [\[RFC3986\] (Berners-Lee, T., Fielding, R., and L. Masinter, “Uniform Resource Identifier (URI): Generic Syntax,” January 2005.)](#RFC3986), which MUST be retained when adding additional query parameters. The logout URI MUST NOT include a fragment component.

The OP renders <iframe src="frontchannel\_logout\_uri"> in a page with the registered logout URI as the source to trigger the logout actions by the RP. Upon receiving a request to render the logout URI in an iframe, the RP clears state associated with the logged-in session, including any cookies and HTML5 local storage. If the End-User is already logged out at the RP when the logout request is received, the logout is considered to have succeeded.

The OP MAY add these query parameters when rendering the logout URI, and if either is included, both MUST be:

> iss
> 
> Issuer Identifier for the OP issuing the front-channel logout request.
> 
> sid
> 
> Identifier for the Session.

The RP MAY verify that any iss and sid parameters match the iss and sid Claims in an ID Token issued for the current session or a recent session of this RP with the OP and ignore the logout request if they do not.

The RP's response SHOULD include Cache-Control directives keeping the response from being cached to prevent cached responses from interfering with future logout requests. It is RECOMMENDED that these directives be used:

  Cache-Control: no-cache, no-store
  Pragma: no-cache

In the case that the RP is also an OP serving as an identity provider to downstream logged-in sessions, it is desirable for the logout request to the RP to likewise trigger downstream logout requests. This is achieved by having the RP serve content in the iframe that contains logout requests to the downstream sessions, which themselves are nested iframes rendering the downstream logout URIs.

If the RP supports [OpenID Connect Dynamic Client Registration 1.0 (Sakimura, N., Bradley, J., and M. Jones, “OpenID Connect Dynamic Client Registration 1.0,” November 2014.)](#OpenID.Registration) \[OpenID.Registration\], it uses this metadata value to register the logout URI:

> frontchannel\_logout\_uri
> 
> OPTIONAL. RP URL that will cause the RP to log itself out when rendered in an iframe by the OP. This URL SHOULD use the https scheme and MAY contain port, path, and query parameter components; however, it MAY use the http scheme, provided that the Client Type is confidential, as defined in Section 2.1 of [OAuth 2.0 (Hardt, D., Ed., “The OAuth 2.0 Authorization Framework,” October 2012.)](#RFC6749) \[RFC6749\], and provided the OP allows the use of http RP URIs. An iss (issuer) query parameter and a sid (session ID) query parameter MAY be included by the OP to enable the RP to validate the request and to determine which of the potentially multiple sessions is to be logged out; if either is included, both MUST be.

It SHOULD also register this related metadata value:

> frontchannel\_logout\_session\_required
> 
> OPTIONAL. Boolean value specifying whether the RP requires that iss (issuer) and sid (session ID) query parameters be included to identify the RP session with the OP when the frontchannel\_logout\_uri is used. If omitted, the default value is false.

  

* * *

 [TOC](#toc) 

### 3.  OpenID Provider Logout Functionality

OPs supporting HTTP-based logout need to keep track of the set of logged-in RPs so that they know what RPs to contact at their logout URIs to cause them to log out. Some OPs track this state using a "visited sites" cookie. OPs contact them in parallel using a dynamically constructed page with HTML <iframe src="frontchannel\_logout\_uri"> tags rendering each logged-in RP's logout URI.

If the OP supports [OpenID Connect Discovery 1.0 (Sakimura, N., Bradley, J., Jones, M., and E. Jay, “OpenID Connect Discovery 1.0,” November 2014.)](#OpenID.Discovery) \[OpenID.Discovery\], it uses this metadata value to advertise its support for HTTP-based logout:

> frontchannel\_logout\_supported
> 
> OPTIONAL. Boolean value specifying whether the OP supports HTTP-based logout, with true indicating support. If omitted, the default value is false.

It SHOULD also register this related metadata value:

> frontchannel\_logout\_session\_supported
> 
> OPTIONAL. Boolean value specifying whether the OP can pass iss (issuer) and sid (session ID) query parameters to identify the RP session with the OP when the frontchannel\_logout\_uri is used. If supported, the sid Claim is also included in ID Tokens issued by the OP. If omitted, the default value is false.

The sid (session ID) Claim used in ID Tokens and as a frontchannel\_logout\_uri parameter has the following definition:

> sid
> 
> OPTIONAL. Session ID - String identifier for a Session. This represents a Session of a User Agent or device for a logged-in End-User at an RP. Different sid values are used to identify distinct sessions at an OP. The sid value need only be unique in the context of a particular issuer. Its contents are opaque to the RP. Its syntax is the same as an OAuth 2.0 Client Identifier.

  

* * *

 [TOC](#toc) 

### 3.1.  Example Front-Channel Logout URL Usage

In this non-normative example, the RP has registered the frontchannel\_logout\_uri value https://rp.example.org/frontchannel\_logout" with the OP. In the simple case, in which frontchannel\_logout\_session\_required is false, the OP causes the front-channel logout to occur by rendering this URL in an iframe:

  https://rp.example.org/frontchannel\_logout

In a second example, in which frontchannel\_logout\_session\_required is true, Issuer and Session ID values are also sent. This example uses an Issuer value of https://server.example.com and a Session ID value of 08a5019c-17e1-4977-8f42-65a12843ea02. In this case, the OP causes the front-channel logout to occur by rendering this URL in an iframe (with line breaks for display purposes only):

  https://rp.example.org/frontchannel\_logout
    ?iss=https://server.example.com
    &sid=08a5019c-17e1-4977-8f42-65a12843ea02

  

* * *

 [TOC](#toc) 

### 4.  Implementation Considerations

This specification defines features used by both Relying Parties and OpenID Providers that choose to implement Front-Channel Logout. All of these Relying Parties and OpenID Providers MUST implement the features that are listed in this specification as being "REQUIRED" or are described with a "MUST".

  

* * *

 [TOC](#toc) 

### 4.1.  User Agents Blocking Access to Third-Party Content

Note that at the time of this writing, some User Agents (browsers) are starting to block access to third-party content by default to block some mechanisms used to track the End-User's activity across sites. Specifically, the third-party content being blocked is website content with an origin different that the origin of the focused User Agent window. Site data includes cookies and any web storage APIs (sessionStorage, localStorage, etc.).

This can prevent the ability for notifications from the OP at the RP from being able to access the RP's User Agent state to implement local logout actions. In particular, the frontchannel\_logout\_uri might not be able to access the RP's login state when rendered by the OP in an iframe because the iframe is in a different origin than the OP's page. Therefore, deployments of this specification are recommended to include defensive code to detect this situation, and if possible, notify the End-User that the requested RP logouts could not be performed. The details of the defensive code needed are beyond the scope of this specification; it may vary per User Agent and may vary over time, as the User Agent tracking prevention situation is fluid and continues to evolve.

[OpenID Connect Back-Channel Logout 1.0 (Jones, M. and J. Bradley, “OpenID Connect Back-Channel Logout 1.0,” August 2020.)](#OpenID.BackChannel) \[OpenID.BackChannel\] is not known to be affected by these developments.

  

* * *

 [TOC](#toc) 

### 5.  Security Considerations

Collisions between Session IDs and the guessing of their values by attackers are prevented by including sufficient entropy in Session ID values.

  

* * *

 [TOC](#toc) 

### 6.  IANA Considerations

  

* * *

 [TOC](#toc) 

### 6.1.  JSON Web Token Claims Registration

This specification registers the following Claim in the IANA "JSON Web Token Claims" registry [\[IANA.JWT.Claims\] (IANA, “JSON Web Token Claims,” .)](#IANA.JWT.Claims) established by [\[JWT\] (Jones, M., Bradley, J., and N. Sakimura, “JSON Web Token (JWT),” May 2015.)](#JWT).

  

* * *

 [TOC](#toc) 

### 6.1.1.  Registry Contents

*   Claim Name: sid
*   Claim Description: Session ID
*   Change Controller: OpenID Foundation Artifact Binding Working Group - openid-specs-ab@lists.openid.net
*   Specification Document(s): [Section 3 (OpenID Provider Logout Functionality)](#OPLogout) of this specification

  

* * *

 [TOC](#toc) 

### 6.2.  OAuth Dynamic Client Registration Metadata Registration

This specification registers the following client metadata definitions in the IANA "OAuth Dynamic Client Registration Metadata" registry [\[IANA.OAuth.Parameters\] (IANA, “OAuth Parameters,” .)](#IANA.OAuth.Parameters) established by [\[RFC7591\] (Richer, J., Ed., Jones, M., Bradley, J., Machulak, M., and P. Hunt, “OAuth 2.0 Dynamic Client Registration Protocol,” July 2015.)](#RFC7591):

  

* * *

 [TOC](#toc) 

### 6.2.1.  Registry Contents

*   Client Metadata Name: frontchannel\_logout\_uri
*   Client Metadata Description: RP URL that will cause the RP to log itself out when rendered in an iframe by the OP
*   Change Controller: OpenID Foundation Artifact Binding Working Group - openid-specs-ab@lists.openid.net
*   Specification Document(s): [Section 2 (Relying Party Logout Functionality)](#RPLogout) of this specification

*   Client Metadata Name: frontchannel\_logout\_session\_required
*   Client Metadata Description: Boolean value specifying whether the RP requires that a sid (session ID) query parameter be included to identify the RP session with the OP when the frontchannel\_logout\_uri is used
*   Change Controller: OpenID Foundation Artifact Binding Working Group - openid-specs-ab@lists.openid.net
*   Specification Document(s): [Section 2 (Relying Party Logout Functionality)](#RPLogout) of this specification

  

* * *

 [TOC](#toc) 

### 6.3.  OAuth Authorization Server Metadata Registry

This specification registers the following metadata name in the IANA "OAuth Authorization Server Metadata" registry [\[IANA.OAuth.Parameters\] (IANA, “OAuth Parameters,” .)](#IANA.OAuth.Parameters) established by [\[RFC8414\] (Jones, M., Sakimura, N., and J. Bradley, “OAuth 2.0 Authorization Server Metadata,” June 2018.)](#RFC8414).

  

* * *

 [TOC](#toc) 

### 6.3.1.  Registry Contents

*   Metadata Name: frontchannel\_logout\_supported
*   Metadata Description: Boolean value specifying whether the OP supports HTTP-based logout, with true indicating support
*   Change Controller: OpenID Foundation Artifact Binding Working Group - openid-specs-ab@lists.openid.net
*   Specification Document(s): [Section 3 (OpenID Provider Logout Functionality)](#OPLogout) of this document

  

* * *

 [TOC](#toc) 

### 7.  References

  

* * *

 [TOC](#toc) 

### 7.1. Normative References

\[IANA.JWT.Claims\]

IANA, “[JSON Web Token Claims](http://www.iana.org/assignments/jwt).”

\[IANA.OAuth.Parameters\]

IANA, “[OAuth Parameters](http://www.iana.org/assignments/oauth-parameters).”

\[OpenID.BackChannel\]

Jones, M. and J. Bradley, “[OpenID Connect Back-Channel Logout 1.0](http://openid.net/specs/openid-connect-backchannel-1_0.html),” August 2020.

\[OpenID.Core\]

Sakimura, N., Bradley, J., Jones, M., de Medeiros, B., and C. Mortimore, “[OpenID Connect Core 1.0](http://openid.net/specs/openid-connect-core-1_0.html),” November 2014.

\[OpenID.Discovery\]

Sakimura, N., Bradley, J., Jones, M., and E. Jay, “[OpenID Connect Discovery 1.0](http://openid.net/specs/openid-connect-discovery-1_0.html),” November 2014.

\[OpenID.RPInitiated\]

Jones, M., de Medeiros, B., Agarwal, N., Sakimura, N., and J. Bradley, “[OpenID Connect RP-Initiated Logout 1.0](http://openid.net/specs/openid-connect-rpinitiated-1_0.html),” August 2020.

\[OpenID.Registration\]

Sakimura, N., Bradley, J., and M. Jones, “[OpenID Connect Dynamic Client Registration 1.0](http://openid.net/specs/openid-connect-registration-1_0.html),” November 2014.

\[OpenID.Session\]

de Medeiros, B., Agarwal, N., Sakimura, N., Bradley, J., and M. Jones, “[OpenID Connect Session Management 1.0](http://openid.net/specs/openid-connect-session-1_0.html),” August 2020.

\[RFC2119\]

Bradner, S., “[Key words for use in RFCs to Indicate Requirement Levels](https://www.rfc-editor.org/info/rfc2119),” BCP 14, RFC 2119, DOI 10.17487/RFC2119, March 1997.

\[RFC3986\]

Berners-Lee, T., Fielding, R., and L. Masinter, “[Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/info/rfc3986),” STD 66, RFC 3986, DOI 10.17487/RFC3986, January 2005.

\[RFC6749\]

Hardt, D., Ed., “[The OAuth 2.0 Authorization Framework](https://www.rfc-editor.org/info/rfc6749),” RFC 6749, DOI 10.17487/RFC6749, October 2012.

\[RFC7230\]

Fielding, R., Ed. and J. Reschke, Ed., “[Hypertext Transfer Protocol (HTTP/1.1): Message Syntax and Routing](https://www.rfc-editor.org/info/rfc7230),” RFC 7230, DOI 10.17487/RFC7230, June 2014.

  

* * *

 [TOC](#toc) 

### 7.2. Informative References

\[JWT\]

Jones, M., Bradley, J., and N. Sakimura, “[JSON Web Token (JWT)](http://tools.ietf.org/html/rfc7519),” RFC 7519, DOI 10.17487/RFC7519, May 2015.

\[RFC7591\]

Richer, J., Ed., Jones, M., Bradley, J., Machulak, M., and P. Hunt, “[OAuth 2.0 Dynamic Client Registration Protocol](https://www.rfc-editor.org/info/rfc7591),” RFC 7591, DOI 10.17487/RFC7591, July 2015.

\[RFC8414\]

Jones, M., Sakimura, N., and J. Bradley, “[OAuth 2.0 Authorization Server Metadata](https://www.rfc-editor.org/info/rfc8414),” RFC 8414, DOI 10.17487/RFC8414, June 2018.

  

* * *

 [TOC](#toc) 

### Appendix A.  Acknowledgements

The OpenID Community would like to thank the following people for their contributions to this specification:

> John Bradley (ve7jtb@ve7jtb.com), Yubico
> 
> Brian Campbell (bcampbell@pingidentity.com), Ping Identity
> 
> Jim des Rivieres (Jim\_des\_Rivieres@ca.ibm.com), IBM
> 
> Vladimir Dzhuvinov (vladimir@connect2id.com), Connect2id
> 
> Joseph Heenan (joseph@authlete.com), Authlete
> 
> Michael B. Jones (mbj@microsoft.com), Microsoft
> 
> Torsten Lodderstedt (torsten@lodderstedt.net), yes.com
> 
> Nat Sakimura (nat@nat.consulting), NAT.Consulting
> 
> Filip Skokan (panva.ip@gmail.com), Auth0

  

* * *

 [TOC](#toc) 

### Appendix B.  Notices

Copyright (c) 2020 The OpenID Foundation.

The OpenID Foundation (OIDF) grants to any Contributor, developer, implementer, or other interested party a non-exclusive, royalty free, worldwide copyright license to reproduce, prepare derivative works from, distribute, perform and display, this Implementers Draft or Final Specification solely for the purposes of (i) developing specifications, and (ii) implementing Implementers Drafts and Final Specifications based on such documents, provided that attribution be made to the OIDF as the source of the material, but that such attribution does not indicate an endorsement by the OIDF.

The technology described in this specification was made available from contributions from various sources, including members of the OpenID Foundation and others. Although the OpenID Foundation has taken steps to help ensure that the technology is available for distribution, it takes no position regarding the validity or scope of any intellectual property or other rights that might be claimed to pertain to the implementation or use of the technology described in this specification or the extent to which any license under such rights might or might not be available; neither does it represent that it has made any independent effort to identify any such rights. The OpenID Foundation and the contributors to this specification make no (and hereby expressly disclaim any) warranties (express, implied, or otherwise), including implied warranties of merchantability, non-infringement, fitness for a particular purpose, or title, related to this specification, and the entire risk as to implementing this specification is assumed by the implementer. The OpenID Intellectual Property Rights policy requires contributors to offer a patent promise not to assert certain patent claims against other contributors and against implementers. The OpenID Foundation invites any interested party to bring to its attention any copyrights, patents, patent applications, or other proprietary rights that may cover technology that may be required to practice this specification.

  

* * *

 [TOC](#toc) 

### Appendix C.  Document History

\[\[ To be removed from the final specification \]\]

\-04

*   Fixed #1030 - Specify the use of HTTPS URIs.
*   Fixed #1176 - Verify that the sid logout parameter matches this claim in an ID Token.
*   Added Implementation Considerations section.
*   Fixed #1003 - Document possible impacts of disabling access to third-party content.
*   Fixed #1133 - Clarify that logout notifications to RPs are idempotent.

\-03

*   Fixed #1085 - Split RP-Initiated Logout into its own specification.
*   Registered the AS metadata value frontchannel\_logout\_supported.
*   Updated affiliations and acknowledgements.

\-02

*   Added explicit definitions for the iss (issuer) and sid (session ID) query parameters that are used with the logout URI.

\-01

*   Scoped Session ID to be Issuer-specific, aligning it with the back-channel logout usage.
*   Finished changing uses of "logout\_uri" to "frontchannel\_logout\_uri".
*   Removed references to terms that are not used.

\-00

*   Renamed HTTP-Based Logout to Front-Channel Logout.
*   Created openid-connect-frontchannel-1\_0 from openid-connect-logout-1\_0 draft 04.
*   Prefixed identifiers with "frontchannel\_" to be parallel with the Back-Channel Logout specification.

  

* * *

 [TOC](#toc) 

### Author's Address

 

Michael B. Jones

 

Microsoft

Email: 

[mbj@microsoft.com](mailto:mbj@microsoft.com)

URI: 

[http://self-issued.info/](http://self-issued.info/)