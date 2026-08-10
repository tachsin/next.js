// The `module.exports = { … }` literal is aliased by a local binding, which the
// module reads its own exports back through. Nothing may be dropped, even though
// `helper` has no importer.
const Self = (module.exports = {
  used: function () {
    return Self.helper()
  },
  helper: function () {
    return 'helper'
  },
})
