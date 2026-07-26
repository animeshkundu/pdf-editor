# 2026-07-26 Spike C: the synchronous signer bridge

**Question.** MuPDF calls the signer through a synchronous callback. WebCrypto is
asynchronous. Can that gap be bridged, or is
[ADR 0018](../adr/0018-signing-via-custom-signer-vtable.md) built on something impossible?

**Answer: yes, via Asyncify, at a cost of about 900 KB on the shipped binary. ADR 0018
survives.** It needs one amendment, recorded below.

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

## What this does not establish

- **Not measured:** the `ASYNCIFY_ONLY` restricted cost, the runtime overhead of stack
  unwinding, or behaviour under `SubtleCrypto` with a real key rather than a `setTimeout`
  standing in for one.
- **Not attempted:** JSPI, which would avoid Asyncify's cost entirely but imposes a
  browser floor. Worth revisiting if the restricted build still costs more than is
  comfortable.
- **Not answered:** whether the whole CMS operation or only the digest must happen inside
  the callback. The bridge works either way, so this stopped being urgent, but it decides
  how much of PKI.js runs under suspension.
- **Not proven:** that MuPDF's own signing path works end to end. This establishes the
  mechanism the path depends on, not the path.

`SIGN-005`, `SIGN-006`, `SIGN-008` and part of `SIGN-007` stay `OPEN` until that last
point is closed. What changes is that they are blocked on ordinary implementation work
rather than on a question that might have had no answer.
