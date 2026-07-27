"""AI Graph MVP — FastAPI 应用入口。"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.tables import router as tables_router
from routers.analyze import router as analyze_router

app = FastAPI(
    title="AI Graph MVP",
    description="AI 驱动关系图谱分析工具",
    version="1.0.0",
)

# CORS — 允许前端开发服务器跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tables_router)
app.include_router(analyze_router)


@app.get("/api/health")
def health_check():
    """健康检查端点。"""
    return {"status": "ok"}
