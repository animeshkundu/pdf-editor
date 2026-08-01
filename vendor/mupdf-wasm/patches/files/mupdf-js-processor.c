/*
 * Buffered pdf_processor bridge.
 *
 * Content streams can contain tens of thousands of operators. Calling into
 * JavaScript for each one is prohibitively expensive, so callbacks append
 * fixed-stride records and payload bytes. JavaScript copies the completed
 * buffer once and reads it with DataView/typed arrays.
 */

#define WASM_PDF_TRACE_MAGIC 0x5052504aU /* "JPRP" in little endian */
#define WASM_PDF_TRACE_VERSION 1
#define WASM_PDF_TRACE_HEADER_WORDS 8
#define WASM_PDF_TRACE_RECORD_WORDS 16
#define WASM_PDF_TRACE_RECORD_SIZE (WASM_PDF_TRACE_RECORD_WORDS * 4)

enum wasm_pdf_operator
{
	WASM_PDF_OP_w = 1,
	WASM_PDF_OP_j,
	WASM_PDF_OP_J,
	WASM_PDF_OP_M,
	WASM_PDF_OP_d,
	WASM_PDF_OP_ri,
	WASM_PDF_OP_i,
	WASM_PDF_OP_gs_begin,
	WASM_PDF_OP_gs_BM,
	WASM_PDF_OP_gs_ca,
	WASM_PDF_OP_gs_CA,
	WASM_PDF_OP_gs_SMask,
	WASM_PDF_OP_gs_end,
	WASM_PDF_OP_q,
	WASM_PDF_OP_Q,
	WASM_PDF_OP_cm,
	WASM_PDF_OP_m,
	WASM_PDF_OP_l,
	WASM_PDF_OP_c,
	WASM_PDF_OP_v,
	WASM_PDF_OP_y,
	WASM_PDF_OP_h,
	WASM_PDF_OP_re,
	WASM_PDF_OP_S,
	WASM_PDF_OP_s,
	WASM_PDF_OP_F,
	WASM_PDF_OP_f,
	WASM_PDF_OP_fstar,
	WASM_PDF_OP_B,
	WASM_PDF_OP_Bstar,
	WASM_PDF_OP_b,
	WASM_PDF_OP_bstar,
	WASM_PDF_OP_n,
	WASM_PDF_OP_W,
	WASM_PDF_OP_Wstar,
	WASM_PDF_OP_BT,
	WASM_PDF_OP_ET,
	WASM_PDF_OP_Tc,
	WASM_PDF_OP_Tw,
	WASM_PDF_OP_Tz,
	WASM_PDF_OP_TL,
	WASM_PDF_OP_Tf,
	WASM_PDF_OP_Tr,
	WASM_PDF_OP_Ts,
	WASM_PDF_OP_Td,
	WASM_PDF_OP_TD,
	WASM_PDF_OP_Tm,
	WASM_PDF_OP_Tstar,
	WASM_PDF_OP_TJ,
	WASM_PDF_OP_Tj,
	WASM_PDF_OP_squote,
	WASM_PDF_OP_dquote,
	WASM_PDF_OP_d0,
	WASM_PDF_OP_d1,
	WASM_PDF_OP_CS,
	WASM_PDF_OP_cs,
	WASM_PDF_OP_SC_pattern,
	WASM_PDF_OP_sc_pattern,
	WASM_PDF_OP_SC_shade,
	WASM_PDF_OP_sc_shade,
	WASM_PDF_OP_SC_color,
	WASM_PDF_OP_sc_color,
	WASM_PDF_OP_G,
	WASM_PDF_OP_g,
	WASM_PDF_OP_RG,
	WASM_PDF_OP_rg,
	WASM_PDF_OP_K,
	WASM_PDF_OP_k,
	WASM_PDF_OP_BI,
	WASM_PDF_OP_sh,
	WASM_PDF_OP_Do_image,
	WASM_PDF_OP_Do_form,
	WASM_PDF_OP_MP,
	WASM_PDF_OP_DP,
	WASM_PDF_OP_BMC,
	WASM_PDF_OP_BDC,
	WASM_PDF_OP_EMC,
	WASM_PDF_OP_BX,
	WASM_PDF_OP_EX,
	WASM_PDF_OP_gs_OP,
	WASM_PDF_OP_gs_op,
	WASM_PDF_OP_gs_OPM,
	WASM_PDF_OP_gs_UseBlackPtComp,
	WASM_PDF_OP_EOD,
	WASM_PDF_OP_END
};

enum wasm_pdf_handle_kind
{
	WASM_PDF_HANDLE_NONE = 0,
	WASM_PDF_HANDLE_FONT = 1,
	WASM_PDF_HANDLE_OBJECT = 2,
	WASM_PDF_HANDLE_IMAGE = 3,
	WASM_PDF_HANDLE_COLORSPACE = 4,
	WASM_PDF_HANDLE_PATTERN = 5,
	WASM_PDF_HANDLE_SHADE = 6
};

typedef struct wasm_pdf_retained_handle
{
	int kind;
	void *pointer;
} wasm_pdf_retained_handle;

typedef struct wasm_pdf_processor_trace
{
	fz_buffer *records;
	fz_buffer *payload;
	fz_buffer *data;
	wasm_pdf_retained_handle *handles;
	size_t handle_count;
	size_t handle_capacity;
} wasm_pdf_processor_trace;

typedef struct wasm_pdf_buffer_processor
{
	pdf_processor super;
	wasm_pdf_processor_trace *trace;
} wasm_pdf_buffer_processor;

static void
wasm_pdf_trace_drop_handle(fz_context *ctx, wasm_pdf_retained_handle handle)
{
	switch (handle.kind)
	{
	case WASM_PDF_HANDLE_FONT:
		pdf_drop_font(ctx, (pdf_font_desc *)handle.pointer);
		break;
	case WASM_PDF_HANDLE_OBJECT:
		pdf_drop_obj(ctx, (pdf_obj *)handle.pointer);
		break;
	case WASM_PDF_HANDLE_IMAGE:
		fz_drop_image(ctx, (fz_image *)handle.pointer);
		break;
	case WASM_PDF_HANDLE_COLORSPACE:
		fz_drop_colorspace(ctx, (fz_colorspace *)handle.pointer);
		break;
	case WASM_PDF_HANDLE_PATTERN:
		pdf_drop_pattern(ctx, (pdf_pattern *)handle.pointer);
		break;
	case WASM_PDF_HANDLE_SHADE:
		fz_drop_shade(ctx, (fz_shade *)handle.pointer);
		break;
	}
}

static void *
wasm_pdf_trace_keep_handle(fz_context *ctx, wasm_pdf_processor_trace *trace, int kind, void *pointer)
{
	void *kept = NULL;

	if (!pointer)
		return NULL;

	if (trace->handle_count == trace->handle_capacity)
	{
		size_t capacity = trace->handle_capacity ? trace->handle_capacity * 2 : 32;
		trace->handles = fz_realloc_array(ctx, trace->handles, capacity, wasm_pdf_retained_handle);
		trace->handle_capacity = capacity;
	}

	switch (kind)
	{
	case WASM_PDF_HANDLE_FONT:
		kept = pdf_keep_font(ctx, (pdf_font_desc *)pointer);
		break;
	case WASM_PDF_HANDLE_OBJECT:
		kept = pdf_keep_obj(ctx, (pdf_obj *)pointer);
		break;
	case WASM_PDF_HANDLE_IMAGE:
		kept = fz_keep_image(ctx, (fz_image *)pointer);
		break;
	case WASM_PDF_HANDLE_COLORSPACE:
		kept = fz_keep_colorspace(ctx, (fz_colorspace *)pointer);
		break;
	case WASM_PDF_HANDLE_PATTERN:
		kept = pdf_keep_pattern(ctx, (pdf_pattern *)pointer);
		break;
	case WASM_PDF_HANDLE_SHADE:
		kept = fz_keep_shade(ctx, (fz_shade *)pointer);
		break;
	}

	trace->handles[trace->handle_count].kind = kind;
	trace->handles[trace->handle_count].pointer = kept;
	trace->handle_count++;
	return kept;
}

static void
wasm_pdf_trace_drop(fz_context *ctx, wasm_pdf_processor_trace *trace)
{
	size_t i;

	if (!trace)
		return;

	for (i = trace->handle_count; i > 0; --i)
		wasm_pdf_trace_drop_handle(ctx, trace->handles[i - 1]);
	fz_free(ctx, trace->handles);
	fz_drop_buffer(ctx, trace->data);
	fz_drop_buffer(ctx, trace->payload);
	fz_drop_buffer(ctx, trace->records);
	fz_free(ctx, trace);
}

static wasm_pdf_processor_trace *
wasm_pdf_trace_new(fz_context *ctx)
{
	wasm_pdf_processor_trace *trace = fz_malloc_struct(ctx, wasm_pdf_processor_trace);

	fz_try(ctx)
	{
		trace->records = fz_new_buffer(ctx, 4096);
		trace->payload = fz_new_buffer(ctx, 4096);
	}
	fz_catch(ctx)
	{
		wasm_pdf_trace_drop(ctx, trace);
		fz_rethrow(ctx);
	}
	return trace;
}

static void
wasm_pdf_record_init(uint32_t record[WASM_PDF_TRACE_RECORD_WORDS], int opcode)
{
	memset(record, 0, WASM_PDF_TRACE_RECORD_SIZE);
	record[0] = (uint32_t)opcode;
}

static void
wasm_pdf_record_float(uint32_t record[WASM_PDF_TRACE_RECORD_WORDS], int index, float value)
{
	memcpy(&record[9 + index], &value, sizeof(value));
}

static void
wasm_pdf_record_handle(fz_context *ctx, wasm_pdf_processor_trace *trace,
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS], int slot, int kind, void *pointer)
{
	void *kept = wasm_pdf_trace_keep_handle(ctx, trace, kind, pointer);
	record[3 + slot * 2] = (uint32_t)kind;
	record[4 + slot * 2] = (uint32_t)(uintptr_t)kept;
}

static void
wasm_pdf_record_payload(fz_context *ctx, wasm_pdf_processor_trace *trace,
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS], const void *data, size_t length)
{
	size_t offset = fz_buffer_storage(ctx, trace->payload, NULL);

	if (offset > UINT32_MAX || length > UINT32_MAX)
		fz_throw(ctx, FZ_ERROR_LIMIT, "PDF processor trace payload exceeds 4 GiB");
	fz_append_data(ctx, trace->payload, data, length);
	record[1] = (uint32_t)offset;
	record[2] = (uint32_t)length;
}

static void
wasm_pdf_record_string(fz_context *ctx, wasm_pdf_processor_trace *trace,
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS], const char *value)
{
	if (value)
		wasm_pdf_record_payload(ctx, trace, record, value, strlen(value));
}

static void
wasm_pdf_record_append(fz_context *ctx, pdf_processor *processor,
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS])
{
	wasm_pdf_buffer_processor *proc = (wasm_pdf_buffer_processor *)processor;
	fz_append_data(ctx, proc->trace->records, record, WASM_PDF_TRACE_RECORD_SIZE);
}

#define RECORD0(NAME, OPCODE) \
	static void js_proc_##NAME(fz_context *ctx, pdf_processor *proc) \
	{ \
		uint32_t record[WASM_PDF_TRACE_RECORD_WORDS]; \
		wasm_pdf_record_init(record, OPCODE); \
		wasm_pdf_record_append(ctx, proc, record); \
	}

#define RECORD_FLOAT1(NAME, OPCODE, A) \
	static void js_proc_##NAME(fz_context *ctx, pdf_processor *proc, float A) \
	{ \
		uint32_t record[WASM_PDF_TRACE_RECORD_WORDS]; \
		wasm_pdf_record_init(record, OPCODE); \
		wasm_pdf_record_float(record, 0, A); \
		wasm_pdf_record_append(ctx, proc, record); \
	}

#define RECORD_INT1(NAME, OPCODE, A) \
	static void js_proc_##NAME(fz_context *ctx, pdf_processor *proc, int A) \
	{ \
		uint32_t record[WASM_PDF_TRACE_RECORD_WORDS]; \
		wasm_pdf_record_init(record, OPCODE); \
		wasm_pdf_record_float(record, 0, (float)A); \
		wasm_pdf_record_append(ctx, proc, record); \
	}

#define RECORD_FLOAT2(NAME, OPCODE, A, B) \
	static void js_proc_##NAME(fz_context *ctx, pdf_processor *proc, float A, float B) \
	{ \
		uint32_t record[WASM_PDF_TRACE_RECORD_WORDS]; \
		wasm_pdf_record_init(record, OPCODE); \
		wasm_pdf_record_float(record, 0, A); \
		wasm_pdf_record_float(record, 1, B); \
		wasm_pdf_record_append(ctx, proc, record); \
	}

#define RECORD_FLOAT3(NAME, OPCODE, A, B, C) \
	static void js_proc_##NAME(fz_context *ctx, pdf_processor *proc, float A, float B, float C) \
	{ \
		uint32_t record[WASM_PDF_TRACE_RECORD_WORDS]; \
		wasm_pdf_record_init(record, OPCODE); \
		wasm_pdf_record_float(record, 0, A); \
		wasm_pdf_record_float(record, 1, B); \
		wasm_pdf_record_float(record, 2, C); \
		wasm_pdf_record_append(ctx, proc, record); \
	}

#define RECORD_FLOAT4(NAME, OPCODE, A, B, C, D) \
	static void js_proc_##NAME(fz_context *ctx, pdf_processor *proc, float A, float B, float C, float D) \
	{ \
		uint32_t record[WASM_PDF_TRACE_RECORD_WORDS]; \
		wasm_pdf_record_init(record, OPCODE); \
		wasm_pdf_record_float(record, 0, A); \
		wasm_pdf_record_float(record, 1, B); \
		wasm_pdf_record_float(record, 2, C); \
		wasm_pdf_record_float(record, 3, D); \
		wasm_pdf_record_append(ctx, proc, record); \
	}

#define RECORD_FLOAT6(NAME, OPCODE, A, B, C, D, E, F) \
	static void js_proc_##NAME(fz_context *ctx, pdf_processor *proc, float A, float B, float C, float D, float E, float F) \
	{ \
		uint32_t record[WASM_PDF_TRACE_RECORD_WORDS]; \
		wasm_pdf_record_init(record, OPCODE); \
		wasm_pdf_record_float(record, 0, A); \
		wasm_pdf_record_float(record, 1, B); \
		wasm_pdf_record_float(record, 2, C); \
		wasm_pdf_record_float(record, 3, D); \
		wasm_pdf_record_float(record, 4, E); \
		wasm_pdf_record_float(record, 5, F); \
		wasm_pdf_record_append(ctx, proc, record); \
	}

#define RECORD_NAME(NAME, OPCODE) \
	static void js_proc_##NAME(fz_context *ctx, pdf_processor *proc, const char *value) \
	{ \
		wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc; \
		uint32_t record[WASM_PDF_TRACE_RECORD_WORDS]; \
		wasm_pdf_record_init(record, OPCODE); \
		wasm_pdf_record_string(ctx, p->trace, record, value); \
		wasm_pdf_record_append(ctx, proc, record); \
	}

RECORD_FLOAT1(w, WASM_PDF_OP_w, linewidth)
RECORD_INT1(j, WASM_PDF_OP_j, linejoin)
RECORD_INT1(J, WASM_PDF_OP_J, linecap)
RECORD_FLOAT1(M, WASM_PDF_OP_M, miterlimit)
RECORD_NAME(ri, WASM_PDF_OP_ri)
RECORD_FLOAT1(i, WASM_PDF_OP_i, flatness)
RECORD_NAME(gs_BM, WASM_PDF_OP_gs_BM)
RECORD_FLOAT1(gs_ca, WASM_PDF_OP_gs_ca, alpha)
RECORD_FLOAT1(gs_CA, WASM_PDF_OP_gs_CA, alpha)
RECORD0(gs_end, WASM_PDF_OP_gs_end)
RECORD0(q, WASM_PDF_OP_q)
RECORD0(Q, WASM_PDF_OP_Q)
RECORD_FLOAT6(cm, WASM_PDF_OP_cm, a, b, c, d, e, f)
RECORD_FLOAT2(m, WASM_PDF_OP_m, x, y)
RECORD_FLOAT2(l, WASM_PDF_OP_l, x, y)
RECORD_FLOAT6(c, WASM_PDF_OP_c, x1, y1, x2, y2, x3, y3)
RECORD_FLOAT4(v, WASM_PDF_OP_v, x2, y2, x3, y3)
RECORD_FLOAT4(y, WASM_PDF_OP_y, x1, y1, x3, y3)
RECORD0(h, WASM_PDF_OP_h)
RECORD_FLOAT4(re, WASM_PDF_OP_re, x, y, w, h)
RECORD0(S, WASM_PDF_OP_S)
RECORD0(s, WASM_PDF_OP_s)
RECORD0(F, WASM_PDF_OP_F)
RECORD0(f, WASM_PDF_OP_f)
RECORD0(fstar, WASM_PDF_OP_fstar)
RECORD0(B, WASM_PDF_OP_B)
RECORD0(Bstar, WASM_PDF_OP_Bstar)
RECORD0(b, WASM_PDF_OP_b)
RECORD0(bstar, WASM_PDF_OP_bstar)
RECORD0(n, WASM_PDF_OP_n)
RECORD0(W, WASM_PDF_OP_W)
RECORD0(Wstar, WASM_PDF_OP_Wstar)
RECORD0(BT, WASM_PDF_OP_BT)
RECORD0(ET, WASM_PDF_OP_ET)
RECORD_FLOAT1(Tc, WASM_PDF_OP_Tc, charspace)
RECORD_FLOAT1(Tw, WASM_PDF_OP_Tw, wordspace)
RECORD_FLOAT1(Tz, WASM_PDF_OP_Tz, scale)
RECORD_FLOAT1(TL, WASM_PDF_OP_TL, leading)
RECORD_INT1(Tr, WASM_PDF_OP_Tr, render)
RECORD_FLOAT1(Ts, WASM_PDF_OP_Ts, rise)
RECORD_FLOAT2(Td, WASM_PDF_OP_Td, tx, ty)
RECORD_FLOAT2(TD, WASM_PDF_OP_TD, tx, ty)
RECORD_FLOAT6(Tm, WASM_PDF_OP_Tm, a, b, c, d, e, f)
RECORD0(Tstar, WASM_PDF_OP_Tstar)
RECORD_FLOAT2(d0, WASM_PDF_OP_d0, wx, wy)
RECORD_FLOAT6(d1, WASM_PDF_OP_d1, wx, wy, llx, lly, urx, ury)
RECORD_NAME(MP, WASM_PDF_OP_MP)
RECORD_NAME(BMC, WASM_PDF_OP_BMC)
RECORD0(EMC, WASM_PDF_OP_EMC)
RECORD0(BX, WASM_PDF_OP_BX)
RECORD0(EX, WASM_PDF_OP_EX)
RECORD_INT1(gs_OP, WASM_PDF_OP_gs_OP, value)
RECORD_INT1(gs_op, WASM_PDF_OP_gs_op, value)
RECORD_INT1(gs_OPM, WASM_PDF_OP_gs_OPM, value)
RECORD0(EOD, WASM_PDF_OP_EOD)
RECORD0(END, WASM_PDF_OP_END)
RECORD_FLOAT1(G, WASM_PDF_OP_G, g)
RECORD_FLOAT1(g, WASM_PDF_OP_g, g)
RECORD_FLOAT3(RG, WASM_PDF_OP_RG, r, g, b)
RECORD_FLOAT3(rg, WASM_PDF_OP_rg, r, g, b)
RECORD_FLOAT4(K, WASM_PDF_OP_K, c, m, y, k)
RECORD_FLOAT4(k, WASM_PDF_OP_k, c, m, y, k)

static void
js_proc_d(fz_context *ctx, pdf_processor *proc, pdf_obj *array, float phase)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, WASM_PDF_OP_d);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, WASM_PDF_HANDLE_OBJECT, array);
	wasm_pdf_record_float(record, 0, phase);
	wasm_pdf_record_append(ctx, proc, record);
}

static void
js_proc_gs_begin(fz_context *ctx, pdf_processor *proc, const char *name, pdf_obj *extgstate)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, WASM_PDF_OP_gs_begin);
	wasm_pdf_record_string(ctx, p->trace, record, name);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, WASM_PDF_HANDLE_OBJECT, extgstate);
	wasm_pdf_record_append(ctx, proc, record);
}

static void
js_proc_gs_SMask(fz_context *ctx, pdf_processor *proc, pdf_obj *smask,
	fz_colorspace *colorspace, float *background, int luminosity, pdf_obj *transfer)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	int count = background && colorspace ? colorspace->n : 0;

	wasm_pdf_record_init(record, WASM_PDF_OP_gs_SMask);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, WASM_PDF_HANDLE_OBJECT, smask);
	wasm_pdf_record_handle(ctx, p->trace, record, 1, WASM_PDF_HANDLE_COLORSPACE, colorspace);
	wasm_pdf_record_handle(ctx, p->trace, record, 2, WASM_PDF_HANDLE_OBJECT, transfer);
	wasm_pdf_record_float(record, 0, (float)luminosity);
	record[15] = (uint32_t)count;
	if (count)
		wasm_pdf_record_payload(ctx, p->trace, record, background, count * sizeof(float));
	wasm_pdf_record_append(ctx, proc, record);
}

static void
js_proc_Tf(fz_context *ctx, pdf_processor *proc, const char *name, pdf_font_desc *font, float size)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, WASM_PDF_OP_Tf);
	wasm_pdf_record_string(ctx, p->trace, record, name);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, WASM_PDF_HANDLE_FONT, font);
	wasm_pdf_record_float(record, 0, size);
	wasm_pdf_record_append(ctx, proc, record);
}

static void
js_proc_TJ(fz_context *ctx, pdf_processor *proc, pdf_obj *array)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, WASM_PDF_OP_TJ);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, WASM_PDF_HANDLE_OBJECT, array);
	wasm_pdf_record_append(ctx, proc, record);
}

static void
wasm_pdf_record_text(fz_context *ctx, pdf_processor *proc, int opcode, char *text, size_t length)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, opcode);
	wasm_pdf_record_payload(ctx, p->trace, record, text, length);
	wasm_pdf_record_append(ctx, proc, record);
}

static void
js_proc_Tj(fz_context *ctx, pdf_processor *proc, char *text, size_t length)
{
	wasm_pdf_record_text(ctx, proc, WASM_PDF_OP_Tj, text, length);
}

static void
js_proc_squote(fz_context *ctx, pdf_processor *proc, char *text, size_t length)
{
	wasm_pdf_record_text(ctx, proc, WASM_PDF_OP_squote, text, length);
}

static void
js_proc_dquote(fz_context *ctx, pdf_processor *proc, float wordspace, float charspace,
	char *text, size_t length)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, WASM_PDF_OP_dquote);
	wasm_pdf_record_payload(ctx, p->trace, record, text, length);
	wasm_pdf_record_float(record, 0, wordspace);
	wasm_pdf_record_float(record, 1, charspace);
	wasm_pdf_record_append(ctx, proc, record);
}

static void
wasm_pdf_record_colors(fz_context *ctx, pdf_processor *proc, int opcode, int count, float *color)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, opcode);
	record[15] = (uint32_t)count;
	if (count)
		wasm_pdf_record_payload(ctx, p->trace, record, color, count * sizeof(float));
	wasm_pdf_record_append(ctx, proc, record);
}

static void js_proc_SC_color(fz_context *ctx, pdf_processor *proc, int n, float *color)
{
	wasm_pdf_record_colors(ctx, proc, WASM_PDF_OP_SC_color, n, color);
}

static void js_proc_sc_color(fz_context *ctx, pdf_processor *proc, int n, float *color)
{
	wasm_pdf_record_colors(ctx, proc, WASM_PDF_OP_sc_color, n, color);
}

static void
wasm_pdf_record_named_handle(fz_context *ctx, pdf_processor *proc, int opcode,
	const char *name, int kind, void *pointer)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, opcode);
	wasm_pdf_record_string(ctx, p->trace, record, name);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, kind, pointer);
	wasm_pdf_record_append(ctx, proc, record);
}

static void js_proc_CS(fz_context *ctx, pdf_processor *proc, const char *name, fz_colorspace *colorspace)
{
	wasm_pdf_record_named_handle(ctx, proc, WASM_PDF_OP_CS, name, WASM_PDF_HANDLE_COLORSPACE, colorspace);
}

static void js_proc_cs(fz_context *ctx, pdf_processor *proc, const char *name, fz_colorspace *colorspace)
{
	wasm_pdf_record_named_handle(ctx, proc, WASM_PDF_OP_cs, name, WASM_PDF_HANDLE_COLORSPACE, colorspace);
}

static void
wasm_pdf_record_pattern(fz_context *ctx, pdf_processor *proc, int opcode,
	const char *name, pdf_pattern *pattern, int count, float *color)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	size_t offset;
	size_t name_length = name ? strlen(name) : 0;
	wasm_pdf_record_init(record, opcode);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, WASM_PDF_HANDLE_PATTERN, pattern);
	offset = fz_buffer_storage(ctx, p->trace->payload, NULL);
	if (offset > UINT32_MAX || name_length > UINT32_MAX)
		fz_throw(ctx, FZ_ERROR_LIMIT, "PDF processor pattern payload exceeds 4 GiB");
	fz_append_uint32_le(ctx, p->trace->payload, (uint32_t)name_length);
	if (name_length)
		fz_append_data(ctx, p->trace->payload, name, name_length);
	if (count)
		fz_append_data(ctx, p->trace->payload, color, count * sizeof(float));
	record[1] = (uint32_t)offset;
	record[2] = (uint32_t)(sizeof(uint32_t) + name_length + count * sizeof(float));
	record[15] = (uint32_t)count;
	wasm_pdf_record_append(ctx, proc, record);
}

static void js_proc_SC_pattern(fz_context *ctx, pdf_processor *proc, const char *name,
	pdf_pattern *pattern, int count, float *color)
{
	wasm_pdf_record_pattern(ctx, proc, WASM_PDF_OP_SC_pattern, name, pattern, count, color);
}

static void js_proc_sc_pattern(fz_context *ctx, pdf_processor *proc, const char *name,
	pdf_pattern *pattern, int count, float *color)
{
	wasm_pdf_record_pattern(ctx, proc, WASM_PDF_OP_sc_pattern, name, pattern, count, color);
}

static void js_proc_SC_shade(fz_context *ctx, pdf_processor *proc, const char *name, fz_shade *shade)
{
	wasm_pdf_record_named_handle(ctx, proc, WASM_PDF_OP_SC_shade, name, WASM_PDF_HANDLE_SHADE, shade);
}

static void js_proc_sc_shade(fz_context *ctx, pdf_processor *proc, const char *name, fz_shade *shade)
{
	wasm_pdf_record_named_handle(ctx, proc, WASM_PDF_OP_sc_shade, name, WASM_PDF_HANDLE_SHADE, shade);
}

static void
js_proc_BI(fz_context *ctx, pdf_processor *proc, fz_image *image, const char *colorspace_name)
{
	wasm_pdf_record_named_handle(ctx, proc, WASM_PDF_OP_BI, colorspace_name,
		WASM_PDF_HANDLE_IMAGE, image);
}

static void js_proc_sh(fz_context *ctx, pdf_processor *proc, const char *name, fz_shade *shade)
{
	wasm_pdf_record_named_handle(ctx, proc, WASM_PDF_OP_sh, name, WASM_PDF_HANDLE_SHADE, shade);
}

static void js_proc_Do_image(fz_context *ctx, pdf_processor *proc, const char *name, fz_image *image)
{
	wasm_pdf_record_named_handle(ctx, proc, WASM_PDF_OP_Do_image, name, WASM_PDF_HANDLE_IMAGE, image);
}

static void js_proc_Do_form(fz_context *ctx, pdf_processor *proc, const char *name, pdf_obj *form)
{
	wasm_pdf_record_named_handle(ctx, proc, WASM_PDF_OP_Do_form, name, WASM_PDF_HANDLE_OBJECT, form);
}

static void
wasm_pdf_record_marked_content(fz_context *ctx, pdf_processor *proc, int opcode,
	const char *tag, pdf_obj *raw, pdf_obj *cooked)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, opcode);
	wasm_pdf_record_string(ctx, p->trace, record, tag);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, WASM_PDF_HANDLE_OBJECT, raw);
	wasm_pdf_record_handle(ctx, p->trace, record, 1, WASM_PDF_HANDLE_OBJECT, cooked);
	wasm_pdf_record_append(ctx, proc, record);
}

static void js_proc_DP(fz_context *ctx, pdf_processor *proc, const char *tag,
	pdf_obj *raw, pdf_obj *cooked)
{
	wasm_pdf_record_marked_content(ctx, proc, WASM_PDF_OP_DP, tag, raw, cooked);
}

static void js_proc_BDC(fz_context *ctx, pdf_processor *proc, const char *tag,
	pdf_obj *raw, pdf_obj *cooked)
{
	wasm_pdf_record_marked_content(ctx, proc, WASM_PDF_OP_BDC, tag, raw, cooked);
}

static void
js_proc_gs_UseBlackPtComp(fz_context *ctx, pdf_processor *proc, pdf_obj *name)
{
	wasm_pdf_buffer_processor *p = (wasm_pdf_buffer_processor *)proc;
	uint32_t record[WASM_PDF_TRACE_RECORD_WORDS];
	wasm_pdf_record_init(record, WASM_PDF_OP_gs_UseBlackPtComp);
	wasm_pdf_record_handle(ctx, p->trace, record, 0, WASM_PDF_HANDLE_OBJECT, name);
	wasm_pdf_record_append(ctx, proc, record);
}

static pdf_processor *
wasm_pdf_new_buffer_processor(fz_context *ctx, wasm_pdf_processor_trace *trace)
{
	wasm_pdf_buffer_processor *proc = pdf_new_processor(ctx, sizeof(wasm_pdf_buffer_processor));

	proc->trace = trace;
	proc->super.requirements = PDF_PROCESSOR_REQUIRES_DECODED_IMAGES;
	proc->super.op_w = js_proc_w;
	proc->super.op_j = js_proc_j;
	proc->super.op_J = js_proc_J;
	proc->super.op_M = js_proc_M;
	proc->super.op_d = js_proc_d;
	proc->super.op_ri = js_proc_ri;
	proc->super.op_i = js_proc_i;
	proc->super.op_gs_begin = js_proc_gs_begin;
	proc->super.op_gs_BM = js_proc_gs_BM;
	proc->super.op_gs_ca = js_proc_gs_ca;
	proc->super.op_gs_CA = js_proc_gs_CA;
	proc->super.op_gs_SMask = js_proc_gs_SMask;
	proc->super.op_gs_end = js_proc_gs_end;
	proc->super.op_q = js_proc_q;
	proc->super.op_Q = js_proc_Q;
	proc->super.op_cm = js_proc_cm;
	proc->super.op_m = js_proc_m;
	proc->super.op_l = js_proc_l;
	proc->super.op_c = js_proc_c;
	proc->super.op_v = js_proc_v;
	proc->super.op_y = js_proc_y;
	proc->super.op_h = js_proc_h;
	proc->super.op_re = js_proc_re;
	proc->super.op_S = js_proc_S;
	proc->super.op_s = js_proc_s;
	proc->super.op_F = js_proc_F;
	proc->super.op_f = js_proc_f;
	proc->super.op_fstar = js_proc_fstar;
	proc->super.op_B = js_proc_B;
	proc->super.op_Bstar = js_proc_Bstar;
	proc->super.op_b = js_proc_b;
	proc->super.op_bstar = js_proc_bstar;
	proc->super.op_n = js_proc_n;
	proc->super.op_W = js_proc_W;
	proc->super.op_Wstar = js_proc_Wstar;
	proc->super.op_BT = js_proc_BT;
	proc->super.op_ET = js_proc_ET;
	proc->super.op_Tc = js_proc_Tc;
	proc->super.op_Tw = js_proc_Tw;
	proc->super.op_Tz = js_proc_Tz;
	proc->super.op_TL = js_proc_TL;
	proc->super.op_Tf = js_proc_Tf;
	proc->super.op_Tr = js_proc_Tr;
	proc->super.op_Ts = js_proc_Ts;
	proc->super.op_Td = js_proc_Td;
	proc->super.op_TD = js_proc_TD;
	proc->super.op_Tm = js_proc_Tm;
	proc->super.op_Tstar = js_proc_Tstar;
	proc->super.op_TJ = js_proc_TJ;
	proc->super.op_Tj = js_proc_Tj;
	proc->super.op_squote = js_proc_squote;
	proc->super.op_dquote = js_proc_dquote;
	proc->super.op_d0 = js_proc_d0;
	proc->super.op_d1 = js_proc_d1;
	proc->super.op_CS = js_proc_CS;
	proc->super.op_cs = js_proc_cs;
	proc->super.op_SC_pattern = js_proc_SC_pattern;
	proc->super.op_sc_pattern = js_proc_sc_pattern;
	proc->super.op_SC_shade = js_proc_SC_shade;
	proc->super.op_sc_shade = js_proc_sc_shade;
	proc->super.op_SC_color = js_proc_SC_color;
	proc->super.op_sc_color = js_proc_sc_color;
	proc->super.op_G = js_proc_G;
	proc->super.op_g = js_proc_g;
	proc->super.op_RG = js_proc_RG;
	proc->super.op_rg = js_proc_rg;
	proc->super.op_K = js_proc_K;
	proc->super.op_k = js_proc_k;
	proc->super.op_BI = js_proc_BI;
	proc->super.op_sh = js_proc_sh;
	proc->super.op_Do_image = js_proc_Do_image;
	proc->super.op_Do_form = js_proc_Do_form;
	proc->super.op_MP = js_proc_MP;
	proc->super.op_DP = js_proc_DP;
	proc->super.op_BMC = js_proc_BMC;
	proc->super.op_BDC = js_proc_BDC;
	proc->super.op_EMC = js_proc_EMC;
	proc->super.op_BX = js_proc_BX;
	proc->super.op_EX = js_proc_EX;
	proc->super.op_gs_OP = js_proc_gs_OP;
	proc->super.op_gs_op = js_proc_gs_op;
	proc->super.op_gs_OPM = js_proc_gs_OPM;
	proc->super.op_gs_UseBlackPtComp = js_proc_gs_UseBlackPtComp;
	proc->super.op_EOD = js_proc_EOD;
	proc->super.op_END = js_proc_END;
	return &proc->super;
}

static void
wasm_pdf_trace_finalize(fz_context *ctx, wasm_pdf_processor_trace *trace)
{
	unsigned char *records;
	unsigned char *payload;
	size_t record_length = fz_buffer_storage(ctx, trace->records, &records);
	size_t payload_length = fz_buffer_storage(ctx, trace->payload, &payload);
	size_t payload_offset = WASM_PDF_TRACE_HEADER_WORDS * 4 + record_length;

	if (record_length / WASM_PDF_TRACE_RECORD_SIZE > UINT32_MAX ||
		payload_offset > UINT32_MAX || payload_length > UINT32_MAX)
		fz_throw(ctx, FZ_ERROR_LIMIT, "PDF processor trace exceeds 4 GiB");

	trace->data = fz_new_buffer(ctx, payload_offset + payload_length);
	fz_append_uint32_le(ctx, trace->data, WASM_PDF_TRACE_MAGIC);
	fz_append_uint32_le(ctx, trace->data, WASM_PDF_TRACE_VERSION);
	fz_append_uint32_le(ctx, trace->data, WASM_PDF_TRACE_RECORD_SIZE);
	fz_append_uint32_le(ctx, trace->data, (uint32_t)(record_length / WASM_PDF_TRACE_RECORD_SIZE));
	fz_append_uint32_le(ctx, trace->data, WASM_PDF_TRACE_HEADER_WORDS * 4);
	fz_append_uint32_le(ctx, trace->data, (uint32_t)payload_offset);
	fz_append_uint32_le(ctx, trace->data, (uint32_t)payload_length);
	fz_append_uint32_le(ctx, trace->data, 0);
	fz_append_data(ctx, trace->data, records, record_length);
	fz_append_data(ctx, trace->data, payload, payload_length);
}

EXPORT
wasm_pdf_processor_trace *wasm_pdf_process_page_contents(pdf_page *page)
{
	wasm_pdf_processor_trace *trace = NULL;
	pdf_processor *processor = NULL;

	fz_try(ctx)
	{
		trace = wasm_pdf_trace_new(ctx);
		processor = wasm_pdf_new_buffer_processor(ctx, trace);
		pdf_process_contents(ctx, processor, page->doc, pdf_page_resources(ctx, page),
			pdf_page_contents(ctx, page), NULL, NULL);
		pdf_close_processor(ctx, processor);
		wasm_pdf_trace_finalize(ctx, trace);
	}
	fz_always(ctx)
		pdf_drop_processor(ctx, processor);
	fz_catch(ctx)
	{
		wasm_pdf_trace_drop(ctx, trace);
		wasm_rethrow(ctx);
	}
	return trace;
}

EXPORT
unsigned char *wasm_pdf_processor_trace_get_data(wasm_pdf_processor_trace *trace)
{
	unsigned char *data = NULL;
	fz_buffer_storage(ctx, trace->data, &data);
	return data;
}

EXPORT
size_t wasm_pdf_processor_trace_get_length(wasm_pdf_processor_trace *trace)
{
	return fz_buffer_storage(ctx, trace->data, NULL);
}

EXPORT
void wasm_pdf_drop_processor_trace(wasm_pdf_processor_trace *trace)
{
	wasm_pdf_trace_drop(ctx, trace);
}

EXPORT
pdf_font_desc *wasm_pdf_keep_font(pdf_font_desc *font)
{
	return pdf_keep_font(ctx, font);
}

EXPORT
void wasm_pdf_drop_font(pdf_font_desc *font)
{
	pdf_drop_font(ctx, font);
}

EXPORT
const char *wasm_pdf_font_name(pdf_font_desc *font)
{
	return font && font->font ? fz_font_name(ctx, font->font) : "";
}

EXPORT
int wasm_pdf_font_is_embedded(pdf_font_desc *font)
{
	return font ? font->is_embedded : 0;
}

EXPORT
int wasm_pdf_font_wmode(pdf_font_desc *font)
{
	return font ? font->wmode : 0;
}

EXPORT
void wasm_pdf_filter_page_contents(pdf_page *page, unsigned int flags)
{
	pdf_filter_options filter_opts = { 0 };
	pdf_sanitize_filter_options sanitize_opts = { 0 };
	pdf_filter_factory factories[2] = { { 0 } };

	factories[0].filter = pdf_new_sanitize_filter;
	factories[0].options = &sanitize_opts;

	filter_opts.recurse = !!(flags & 1);
	filter_opts.instance_forms = !!(flags & 2);
	filter_opts.ascii = !!(flags & 4);
	filter_opts.no_update = !!(flags & 8);
	filter_opts.newlines = !!(flags & 16);
	filter_opts.filters = factories;

	TRY({
		pdf_filter_page_contents(ctx, page->doc, page, &filter_opts);
	})
}

EXPORT
int wasm_pdf_count_signatures(pdf_document *doc)
{
	INTEGER(pdf_count_signatures, doc)
}

EXPORT
int wasm_pdf_signature_byte_range(pdf_document *doc, pdf_obj *signature, fz_range *byte_range)
{
	INTEGER(pdf_signature_byte_range, doc, signature, byte_range)
}

EXPORT
int wasm_pdf_widget_is_signed(pdf_annot *widget)
{
	INTEGER(pdf_widget_is_signed, widget)
}

EXPORT
int wasm_pdf_signature_is_signed(pdf_document *doc, pdf_obj *field)
{
	INTEGER(pdf_signature_is_signed, doc, field)
}

EXPORT
char *wasm_pdf_signature_info(char *name, pdf_pkcs7_distinguished_name *dn, char *reason, char *location, double date, int include_labels)
{
	char *result;
	TRY({
		result = pdf_signature_info(ctx, name, dn, reason, location, (int64_t)date, include_labels);
	})
	return result;
}

EXPORT
int wasm_pdf_signature_incremental_change_since_signing(pdf_document *doc, pdf_obj *signature)
{
	INTEGER(pdf_signature_incremental_change_since_signing, doc, signature)
}

#undef RECORD0
#undef RECORD_FLOAT1
#undef RECORD_INT1
#undef RECORD_FLOAT2
#undef RECORD_FLOAT3
#undef RECORD_FLOAT4
#undef RECORD_FLOAT6
#undef RECORD_NAME
