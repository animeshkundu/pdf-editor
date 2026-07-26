# 2026-07-26 Spike C: the synchronous signer bridge

**Question.** MuPDF calls the signer through a synchronous callback. WebCrypto is
asynchronous. Can that gap be bridged, or is
[ADR 0018](../adr/0018-signing-via-custom-signer-vtable.md) built on something impossible?

**Answer, stated narrowly: Asyncify can bridge a reduced synchronous-shaped C call to an
awaited Promise. The real MuPDF signing path and the runtime costs remain untested.**

That is weaker than this document originally claimed. The first version said "the bridge
works, ADR 0018 survives", which outran the evidence in two ways corrected below. The
mechanism the ADR depends on is demonstrably real; whether the ADR's design works is not
established.

## Why this mattered

Of the five spikes, this was the only one whose failure would supersede an ADR rather
than move a feature between honesty labels. Every other spike changes what we may
promise. This one asked whether a design decision was sound at all, which is why the
roadmap says it should run early: cheap to attempt, expensive to discover late.

The shape of the problem, from `include/mupdf/pdf/form.h:226`:

```c
typedef int (pdf_pkcs7_create_digest_fn)(fz_context *ctx, pdf_pkcs7_signer *signer,
                                         fz_stream *in, unsigned char *digest,
                                         size_t digest_len);
```

Synchronous return, caller-supplied buffer, invoked from deep inside C. The engine is
single-threaded WASM with no pthreads, so there is no thread to block and no
`Atomics.wait` to use. The comment above that typedef says the callback creates "a
signature", not a digest, so precomputing a hash and handing it in was not a reliable
escape: the whole CMS operation may need to complete inside the call.

## Method

The question was reduced to its load-bearing part and tested without MuPDF: a
synchronous C function, matching the typedef's shape and **called from another C
function** so it is invoked mid-stack rather than at the entry point, which must obtain
bytes from a promise before it returns.

```c
EM_ASYNC_JS(int, js_sign, (unsigned char *out, int cap), {
  const result = await new Promise((resolve) =>
    setTimeout(() => resolve(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x42])), 10));
  if (result.length > cap) return -1;
  HEAPU8.set(result, out);
  return result.length;
});

int create_digest(unsigned char *digest, int digest_len) {
  return js_sign(digest, digest_len);   // synchronous signature, async underneath
}
```

Built with `-sASYNCIFY`, then the same flag applied to a full MuPDF build to measure what
it costs on the binary we actually ship.

## Result 1: the bridge works

```
callback returned 5 bytes, contents correct
deep_caller returned: 5
PASS: synchronous C callback obtained bytes from async JS
```

The bytes arrive in the caller-supplied buffer, correct, and the synchronous function
returns them normally. Asyncify unwinds the WASM stack at the suspend point and rewinds
it when the promise settles, which the C code cannot observe.

## Result 2: the cost is 8.9%, not 157%

Measured on the real binary rather than the reduction, because the reduction is
misleading:

| Build                  |      Bytes |     Ratio |
| ---------------------- | ---------: | --------: |
| Reduction, no Asyncify |      6,211 |     1.00x |
| Reduction, Asyncify    |     15,938 | **2.57x** |
| MuPDF stock            | 10,408,550 |     1.00x |
| MuPDF, Asyncify        | 11,331,113 | **1.09x** |

The toy exaggerates by a factor of nearly thirty, because Asyncify's fixed instrumentation
dominates a 6 KB binary and disappears into a 10 MB one. **Anyone sizing this from a
minimal example would have concluded the design was unaffordable.** The delta on the
shipped artifact is 922,563 bytes, about 8.9%.

That figure is for **blanket** instrumentation, where every function is made suspendable.
`ASYNCIFY_ONLY` restricts it to the functions on the actual suspend path, and the signer
path is a narrow slice of MuPDF. The real cost is therefore an upper bound of 900 KB and
probably far less. Measuring the restricted build is follow-up work; the blanket number
already clears the decision.

## The amendment ADR 0018 needs

**Every JS entry point that can reach the signer becomes asynchronous.** The Asyncify
export suspends, so a caller that does not await it receives a return value before the
work has happened. The first run of this spike made exactly that mistake and reported
`0` while the callback was still in flight, printing its success message afterwards. The
mechanism was working; the harness was wrong.

This is compatible with the engine as designed. Every call already crosses a worker
boundary and is already a promise, so `save` becoming async costs the architecture
nothing. But it must be written down, because a future caller that treats a signing save
as synchronous will get a silent wrong answer rather than an error, which is the same
failure this spike hit in its own first run.

## Correction after adversarial review: two overclaims

Both were found by a reviewer who had not run the experiment, which is the argument for
having one.

### "The bridge works" was scoped to a reduction, not to MuPDF

What the experiment exercises: an awaited Asyncify export can suspend a reduced C call
stack, await JavaScript, copy bytes into WASM memory, and resume.

What it does **not** exercise, and each of these is where the real design could fail:
MuPDF's actual indirect signer dispatch, the call graph from a production export down to
the callback, reading or preserving the supplied `fz_stream`, real WebCrypto signing, CMS
construction and encoding, realistic output lengths against the caller's buffer,
rejection and cancellation and C exception propagation, Asyncify stack capacity on the
real path's depth, PDF finalisation after rewind, external verification of the resulting
signature, and re-entering the instance while a signing operation is suspended.

Compiling MuPDF with `-sASYNCIFY` and measuring the binary proves none of those.

The false first run is where the absence of an independent check is most visible. The
harness let the C-facing result report `0` while success was logged afterwards, and it
was noticed only because the log order looked wrong. **A negative control that omits the
await and is required to fail should exist**, rather than relying on the experimenter
spotting an anomaly.

### "8.9%, an upper bound" is one static byte count, not a cost

The arithmetic is right for the artifacts measured: 922,563 bytes, 1.0886x. But nothing
about runtime was measured: unwind and rewind latency on a real deep stack, transient and
peak memory to preserve that stack, slowdown of ordinary non-signing operations whose
functions were transformed, Asyncify stack exhaustion, load and compile time, or the
constraint that the instance may not be safely re-entered while suspended. For an engine
with a 2 GiB heap ceiling and a documented manual-memory discipline, the memory figure
may matter more than the bytes on disk.

"Blanket instrumentation" was also wrong. Emscripten's Asyncify uses call-graph analysis
rather than transforming everything, so `ASYNCIFY_ONLY` reduces work only if the complete
real path is known, and indirect calls are exactly where an over-narrowed list fails at
runtime rather than at build time.

And the toy-versus-full comparison says less than it appeared to. The **absolute**
increase rose from 9,727 bytes to 922,563. The percentage fell because the denominator
grew, most of it code unrelated to the async path. The honest conclusion is "the toy
percentage does not extrapolate", not "the cost is acceptable".

### A materially better design was not considered

Before committing to whole-call-graph Asyncify, an explicit **two-phase API** deserves
evaluation and probably wins: have MuPDF prepare the ByteRange and a `/Contents`
placeholder and return control to JavaScript, sign asynchronously in ordinary JS with no
suspension at all, then re-enter WASM to install the CMS value and finalise. It costs
more fork work and avoids suspended-instance risk, whole-graph instrumentation, and every
runtime cost listed above. JSPI is a third option where the browser matrix allows it.

This was listed in ADR 0018 as one of four candidate resolutions and then not pursued,
because Asyncify worked first. Working first is not the same as being the right choice.

`SIGN-005`, `SIGN-006`, `SIGN-008` and part of `SIGN-007` stay `OPEN` until that last
point is closed. What changes is that they are blocked on ordinary implementation work
rather than on a question that might have had no answer.
