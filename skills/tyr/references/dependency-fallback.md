# Fallback for a dependency the catalog does not cover

Used when a dependency matches no catalog row, or the catalog row names an image
that is not installed. Applies to isolation mode.

## Routes, tried in order

1. **The real engine as a container**, if an image is installed locally.
2. **A purpose-built emulator or fake** (LocalStack, Azurite, fake-gcs-server,
   DynamoDB Local, the Pub/Sub emulator, a Service Bus emulator), if installed.
3. **A protocol-level mock.** For HTTP-based protocols use WireMock. Otherwise
   describe a small stub in the plan: what protocol, what it answers to what,
   and which image or tool would run it. If no suitable image is installed, say
   so; it is a precondition.
4. **Disable it** through a profile or feature flag the service already has,
   when the cases do not exercise it. Name the property and the profile.
5. **Out of scope**, only by the user's explicit choice, recorded in the plan
   with the cases that lose coverage.

The first route that works is the recommendation; the others are listed as
options. A dependency that ends at route 4 or 5 is always shown at the gate; the
skill never decides it silently.

## What to record

The six answers from `dependency-catalog.md`. For routes 4 and 5, "n/a" with the
reason. For route 3, the stub's contract: protocol, endpoints or operations,
the responses per case.

## Doubts this produces

- no usable local image (proprietary, licensed, SaaS only)
- a managed cloud service with no emulator
- a protocol the available mocks cannot speak
- an emulator known to cover only part of the real API: list which APIs the
  cases use and flag any the emulator lacks

## Growing the catalog

When the fallback is used twice for the same technology, that technology should
get a catalog row and a profile. Mention it in the delivery summary so the skill
can be extended; do not edit the skill during a run.
