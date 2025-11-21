// Simple health check for Vercel
module.exports = (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "hireedge-backend-mvp",
    time: new Date().toISOString()
  });
};
