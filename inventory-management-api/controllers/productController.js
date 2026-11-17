const mongoose = require("mongoose");
const Product = require("../models/Product");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

exports.createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json({ success: true, data: product });
});

exports.getProducts = asyncHandler(async (req, res) => {
  const {
    category,
    supplier,
    search,
    minPrice,
    maxPrice,
    sort = "-createdAt",
    page = "1",
    limit = "10"
  } = req.query;

  const pageNumber = Number(page);
  const limitNumber = Number(limit);

  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return res.status(400).json({ success: false, message: "page must be a positive integer" });
  }
  if (!Number.isInteger(limitNumber) || limitNumber < 1 || limitNumber > 100) {
    return res.status(400).json({ success: false, message: "limit must be between 1 and 100" });
  }
  if (minPrice !== undefined && (!Number.isFinite(Number(minPrice)) || Number(minPrice) < 0)) {
    return res.status(400).json({ success: false, message: "minPrice must be a non-negative number" });
  }
  if (maxPrice !== undefined && (!Number.isFinite(Number(maxPrice)) || Number(maxPrice) < 0)) {
    return res.status(400).json({ success: false, message: "maxPrice must be a non-negative number" });
  }
  if (minPrice !== undefined && maxPrice !== undefined && Number(minPrice) > Number(maxPrice)) {
    return res.status(400).json({ success: false, message: "minPrice cannot exceed maxPrice" });
  }

  const filter = {};
  if (category) filter.category = new RegExp(`^${escapeRegex(category)}$`, "i");
  if (supplier) filter.supplier = new RegExp(escapeRegex(supplier), "i");
  if (search) {
    const term = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: term }, { sku: term }, { category: term }, { supplier: term }];
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = Number(minPrice);
    if (maxPrice !== undefined) filter.price.$lte = Number(maxPrice);
  }

  const allowedSortFields = ["name", "price", "quantity", "createdAt", "updatedAt", "category"];
  const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
  if (!allowedSortFields.includes(sortField)) {
    return res.status(400).json({
      success: false,
      message: `sort must use one of: ${allowedSortFields.join(", ")} (prefix with - for descending)`
    });
  }
  const sortOption = { [sortField]: sort.startsWith("-") ? -1 : 1 };
  const skip = (pageNumber - 1) * limitNumber;

  const [products, total] = await Promise.all([
    Product.find(filter).sort(sortOption).skip(skip).limit(limitNumber),
    Product.countDocuments(filter)
  ]);

  res.status(200).json({
    success: true,
    count: products.length,
    pagination: {
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber)
    },
    data: products
  });
});

exports.getProductById = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product ID" });
  }
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "Product not found" });
  res.status(200).json({ success: true, data: product });
});

exports.updateProduct = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product ID" });
  }

  const allowedFields = ["name", "sku", "category", "price", "quantity", "reorderLevel", "supplier"];
  const updates = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: "Provide at least one valid field to update" });
  }

  const product = await Product.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true
  });
  if (!product) return res.status(404).json({ success: false, message: "Product not found" });
  res.status(200).json({ success: true, data: product });
});

exports.deleteProduct = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product ID" });
  }
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "Product not found" });
  res.status(200).json({ success: true, message: "Product deleted successfully", data: product });
});

exports.adjustStock = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product ID" });
  }
  const change = Number(req.body.change);
  if (!Number.isInteger(change) || change === 0) {
    return res.status(400).json({ success: false, message: "change must be a non-zero integer (positive to add, negative to remove)" });
  }

  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, quantity: { $gte: Math.max(0, -change) } },
    { $inc: { quantity: change } },
    { new: true, runValidators: true }
  );

  if (!product) {
    const exists = await Product.exists({ _id: req.params.id });
    if (!exists) return res.status(404).json({ success: false, message: "Product not found" });
    return res.status(400).json({ success: false, message: "Insufficient stock: quantity cannot become negative" });
  }

  res.status(200).json({ success: true, message: "Stock updated successfully", data: product });
});

exports.getLowStockProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({
    $expr: { $lte: ["$quantity", "$reorderLevel"] }
  }).sort({ quantity: 1 });

  res.status(200).json({ success: true, count: products.length, data: products });
});

exports.getInventorySummary = asyncHandler(async (req, res) => {
  const summary = await Product.aggregate([
    {
      $group: {
        _id: "$category",
        productCount: { $sum: 1 },
        totalUnits: { $sum: "$quantity" },
        totalStockValue: { $sum: { $multiply: ["$price", "$quantity"] } },
        averagePrice: { $avg: "$price" }
      }
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        category: "$_id",
        productCount: 1,
        totalUnits: 1,
        totalStockValue: { $round: ["$totalStockValue", 2] },
        averagePrice: { $round: ["$averagePrice", 2] }
      }
    }
  ]);

  res.status(200).json({ success: true, count: summary.length, data: summary });
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
