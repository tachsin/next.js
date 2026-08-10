(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(["output/0p5q_snapshot_cjs-remove-unused-exports_object-literal-self-alias_input_1bht7z7._.js",
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/cjs-remove-unused-exports/object-literal-self-alias/input/index.js [test] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$cjs$2d$remove$2d$unused$2d$exports$2f$object$2d$literal$2d$self$2d$alias$2f$input$2f$lib$2e$js__$5b$test$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/turbopack/crates/turbopack-tests/tests/snapshot/cjs-remove-unused-exports/object-literal-self-alias/input/lib.js [test] (ecmascript)");
;
console.log((0, __TURBOPACK__imported__module__$5b$project$5d2f$turbopack$2f$crates$2f$turbopack$2d$tests$2f$tests$2f$snapshot$2f$cjs$2d$remove$2d$unused$2d$exports$2f$object$2d$literal$2d$self$2d$alias$2f$input$2f$lib$2e$js__$5b$test$5d$__$28$ecmascript$29$__["used"])());
__turbopack_context__.s([]);
}),
"[project]/turbopack/crates/turbopack-tests/tests/snapshot/cjs-remove-unused-exports/object-literal-self-alias/input/lib.js [test] (ecmascript)", ((__turbopack_context__, module, exports) => {

// The `module.exports = { … }` literal is aliased by a local binding, which the
// module reads its own exports back through. Nothing may be dropped, even though
// `helper` has no importer.
const Self = module.exports = {
    used: function() {
        return Self.helper();
    },
    helper: function() {
        return 'helper';
    }
};
}),
]);

//# sourceMappingURL=0p5q_snapshot_cjs-remove-unused-exports_object-literal-self-alias_input_1bht7z7._.js.map