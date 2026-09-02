from database import SessionLocal
from models import AppConfig

db = SessionLocal()
api_key = db.query(AppConfig).filter_by(key="GOOGLE_BOOKS_API_KEY").first()
print("API Key:", api_key.value if api_key else "Not set")
