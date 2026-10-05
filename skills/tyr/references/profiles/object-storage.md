# Profile: object storage

S3 (MinIO or LocalStack), GCS (fake-gcs-server), Azure Blob (Azurite).
Isolation mode.

## Container

The emulator image installed locally. Health check: MinIO `/minio/health/live`,
LocalStack `/_localstack/health`, or the emulator's port. Synthetic access key
and secret, fixed in the plan.

## Redirect

Override the endpoint (`...s3.endpoint`, `STORAGE_EMULATOR_HOST`, the Azurite
connection string) and enable path-style access when the SDK needs it for an
emulator. Credentials are the synthetic ones.

## Initialise

Create the buckets or containers the service expects (names from config) and any
lifecycle or notification settings the cases depend on.

## Seed

Per case, `seeds/<T#>/objects/`: objects with key, content type, metadata and
content. Upload with the emulator's CLI or API before the trigger.

## Reset

Delete the objects the case created or uploaded, or recreate the bucket.

## Assert

List the bucket and read the object the service wrote: key, content type,
metadata, content hash or fields. For "nothing is stored", assert the listing is
empty under the expected prefix.

## Notes

Emulators cover part of the real API. If a case uses presigned URLs, versioning,
object lock or event notifications, flag whether the chosen emulator supports
them.
