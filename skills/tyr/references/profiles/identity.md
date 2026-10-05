# Profile: identity (OIDC, OAuth2, Keycloak)

Isolation mode. Two routes: a real identity provider in a container, or WireMock
playing the token and JWKS endpoints.

## Choosing the route

- The service only validates JWTs (resource server): WireMock serving the
  well-known document and JWKS is enough, and tokens are signed by a key pair
  generated for the run. Lighter, and failure injection is easy.
- The service logs users in, uses roles or realms from the provider, or calls the
  provider's admin API: Keycloak (or the provider's image) with a realm import.

State the route and why in the plan.

## Container

Keycloak or equivalent from the local images, with a health check on the realm's
`/.well-known/openid-configuration`. For the WireMock route, see
`http-wiremock.md`.

## Redirect

Override the issuer and JWKS keys (`spring.security.oauth2.resourceserver.jwt.issuer-uri`
or `jwk-set-uri`) with the container. The issuer in issued tokens must match
what the service expects.

## Initialise

Keycloak: a realm import file with the realm, clients, roles and test users the
cases need (synthetic credentials). WireMock route: the discovery document and
JWKS built from the run's public key.

## Seed

Per case: the users, roles and scopes the case uses, and the token to present.
Obtain tokens through the provider's token endpoint (password or client
credentials grant on the test realm), or sign them for the WireMock route, with
the claims, audience, scope and expiry the case needs. Expired, wrongly signed
and wrong-audience tokens are ordinary cases.

## Reset

Remove users or sessions created by the case; restore the realm if it changed.

## Assert

The service's own response to the presented token (200, 401, 403), and, where the
requirement says so, the identity the service recorded (read through its API).
