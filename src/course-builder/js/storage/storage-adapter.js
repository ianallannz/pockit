// ── Storage adapter ──────────────────────────────────────────
// The shape every storage backend implements — documentation only (plain JS,
// nothing to enforce it at runtime), so course-builder.js's load()/save()
// never need to know which one is active. A future Supabase-backed adapter
// implements the same three methods.
//
//   async load()      → State | null   — State is exactly the shape
//                                         local-storage-adapter.js's save()
//                                         already writes: { courses,
//                                         activeCourseId, nextId,
//                                         nextBlockId, nextLessonId,
//                                         nextCourseId, nextTimetableId,
//                                         nextNoteId, profile }. null means
//                                         "nothing saved yet", not "empty
//                                         state". `profile` (title/
//                                         firstName/lastName/jobTitle/
//                                         employer/avatarSrc) is root-level,
//                                         not per-course — one person's
//                                         identity, used across every
//                                         course this backend holds — and,
//                                         unlike attachments below, needs
//                                         no sign-in or special capability
//                                         to read/write the text fields;
//                                         only avatarSrc's actual photo
//                                         bytes go through the optional
//                                         `avatar` capability further down.
//   async save(state) → void           — idempotent full-snapshot write;
//                                         the adapter does its own diffing
//                                         if that matters for its backend
//                                         (see vault-adapter.js).
//   describe()        → { label }      — for a sidebar "connected to: ―"
//                                         indicator.
//
// Optional capability — present only on adapters that can store binary
// files (feature-detected by the UI via `activeAdapter.attachments`, e.g.
// resolveImageSrc()/uploadImage() in course-builder.js):
//
//   attachments.save(courseId, file)
//                      → { src }         — persists `file`, returns a
//                                          course-relative reference string
//                                          (e.g. "attachments/<hash>.<ext>")
//                                          to store on the block/card. The
//                                          reference shape is the contract:
//                                          any adapter implementing this
//                                          must return references in this
//                                          form so resolve() below — and
//                                          the UI code that calls it — never
//                                          needs to know which adapter is
//                                          active.
//   attachments.resolve(courseId, reference)
//                      → string | null   — turns a stored reference back
//                                          into a URL usable in an <img src>
//                                          (vault-adapter.js: a cached
//                                          object URL; a hosted adapter may
//                                          instead return a signed URL that
//                                          expires — callers should treat
//                                          the string as usable now, not as
//                                          cacheable forever).
//
// Optional capability, same idea as attachments above but unscoped by
// course — one profile photo per backend, not per course (feature-detected
// via `activeAdapter.avatar`, e.g. updateProfileDetails() in
// course-builder.js):
//
//   avatar.save(file)     → { src }        — persists `file`, returns a
//                                             reference string (shape is
//                                             each adapter's own choice —
//                                             unlike attachments' shared
//                                             "attachments/<hash>.<ext>"
//                                             convention, nothing else ever
//                                             needs to parse this one) to
//                                             store as profile.avatarSrc.
//   avatar.resolve(reference)
//                          → string | null — same resolve-to-a-usable-URL
//                                             contract as attachments.resolve().
