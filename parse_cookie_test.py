def parse_cookie_str(cookie: str) -> dict:
    return {k.strip(): v.strip() for k, v in [item.split("=", 1) for item in cookie.split(";") if "=" in item]}

print(parse_cookie_str("a=1; b=2; c=3"))
