function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((item) => item.message);
    return res.status(400).json({ success: false, message: "Validation failed", errors: messages });
  }

  if (err.name === "CastError") {
    return res.status(400).json({ success: false, message: "Invalid value supplied" });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    return res.status(409).json({ success: false, message: `${field} already exists` });
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ success: false, message: "Invalid JSON body" });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error"
  });
}

module.exports = { notFound, errorHandler };
