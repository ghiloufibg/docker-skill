# Profile: mail (SMTP)

Mailpit or MailHog. Isolation mode.

## Container

The mail catcher installed locally: SMTP port plus an HTTP API/UI port. Health
check: Mailpit `/api/v1/info`, MailHog `/api/v2/messages`.

## Redirect

Override `spring.mail.host` and `spring.mail.port` to the container's SMTP port.
Turn off TLS and authentication in the override if the service requires them by
default and the catcher does not.

## Initialise

Nothing.

## Seed

None. Mail is an output.

## Reset

Delete all messages through the API (Mailpit `DELETE /api/v1/messages`) between
cases.

## Assert

Read the inbox through the HTTP API with a bounded timeout: recipient, sender,
subject, body (text and HTML), attachments and their names, and the number of
messages. For "no email is sent", wait the timeout and assert the inbox is
empty.
