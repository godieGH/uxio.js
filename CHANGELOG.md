# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog" and follows semantic versioning:
- MAJOR version when you make incompatible API changes,
- MINOR version when you add functionality in a backwards-compatible manner,
- PATCH version when you make backwards-compatible bug fixes.

---

## [v2.0.0] - 2025-08-18

Major release: clarifies API, standardizes configuration keys, and improves documentation and error semantics.

### Added
- Officially prefer `fieldname` as the canonical configuration key for identifying uploaded form fields.
- Expanded README with detailed tables, examples, and an explicit migration guide from `filename` → `fieldname`.
- More detailed Error Handling section in README, including mappings from common conditions to HTTP-style status codes.
- Clear rollback semantics documented for both `save()` and `send()` operations.
- Changelog and release notes templates.

### Changed
- Documentation: replaced legacy examples using `filename` with `fieldname` and standardized validation property names to `validations.maxSize` and `validations.mimeType`.
- README: restored and expanded configuration/property tables for quick reference.
- save() and send() usage examples improved for clarity and consistency.

### Deprecated
- `filename` configuration key: still supported for backward compatibility, but emits a deprecation warning. It will be removed in a future major release.

### Fixed
- Documentation typos and inconsistent validation examples.

### Migration notes
- Replace `filename` with `fieldname` in all configs (strings or string arrays).
- Replace `validations.size` (if used) with `validations.maxSize`.
- Review usages of any deprecated keys before upgrading to the next major beyond v2.0.0.

---

## [v1.3.0] - 2025-07-XX

Medium/minor release: introduced network send capability and provider support.

### Added
- `Uxio.files.send(config, req.uxio)` for sending uploaded files to external providers.
  - Initial providers: `s3` and `customHttp`.
- Provider options for `s3`:
  - `options.bucket`, `options.region`, `options.credentials` (AWS SDK v3 compatible).
- Provider options for `customHttp`:
  - `options.url`, `options.axiosConfig` (optional).
- Best-effort rollback for S3 uploads: previously-uploaded objects will be deleted if an error occurs during a multi-file send operation.
- Support for per-config `validations` and `rename` in `send()` to mirror `save()` semantics.
- Integration with `axios` for `customHttp` uploads.
- Metadata extraction step (via `getMetadata`) added to `send()` responses.

### Changed
- `save()` and `send()` now both include metadata in their responses when available.
- `send()` returns provider-specific result shapes merged with local metadata.

### Fixed
- Corrected handling of file stream inputs for network uploads.
- Minor bug fixes for error propagation from provider upload failures.

### Notes / Limitations
- Rollback for `customHttp` is not implemented generically because deletion requires a server-specific API. If the destination exposes a delete endpoint, implement a provider integration that performs that delete as part of rollback.
- Ensure proper credentials and least-privilege access for S3 operations.

---

## Suggested release notes (short)

v2.0.0 — Prefer `fieldname` over the deprecated `filename`, improved docs (tables + migration guide), standardized validation keys, and expanded error + rollback documentation.

v1.3.0 — Added `send()` for uploading to external providers (S3, custom HTTP) with provider options and best-effort S3 rollback.

---

## Examples: upgrade / migration checklist

- Search and replace usages of `filename` → `fieldname` (review results before committing).
- Update validation keys:
  - `validations.size` → `validations.maxSize`
  - `validations.mimeTypes`/other variants → `validations.mimeType`
- Verify `send()` provider configs:
  - For S3: confirm `bucket`, `region`, and `credentials` present and scoped correctly.
  - For custom HTTP: confirm `options.url` and whether deletion endpoint exists if you require rollback.
- Run integration tests that exercise both `save()` and `send()` flows, including error cases to validate rollback behavior.

---

## Contributing & release process notes

- When cutting the next major that removes `filename`, include an automated codemod suggestion in the migration guide and a prominent deprecation notice in console logs at runtime.
- For any provider-related changes (e.g., adding new providers), include explicit rollback strategies and tests for failure scenarios.
- Tag releases following semantic versions (e.g., `v2.0.0`, `v1.3.0`) and include the short release notes above as the GitHub release body.

---

## License

MIT