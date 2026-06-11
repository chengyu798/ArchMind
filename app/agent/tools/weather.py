"""天气工具，调用公开地理编码和天气接口获取真实天气数据。"""
import urllib.parse
import urllib.request
import json

from langchain_core.tools import tool


def _fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "agent-console/0.1"})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


@tool(description="获取指定城市的实时天气摘要。仅当用户明确询问天气时调用；输入城市名，返回温度、风速和天气代码。")
def get_weather(city: str) -> str:
    normalized_city = city.strip()
    if not normalized_city:
        return "城市名不能为空。"
    if len(normalized_city) > 60:
        return "城市名过长，请提供一个明确的城市名。"

    query = urllib.parse.quote(normalized_city)

    try:
        geo = _fetch_json(f"https://geocoding-api.open-meteo.com/v1/search?name={query}&count=1&language=zh&format=json")
        results = geo.get("results") or []
        if not results:
            return f"没有查询到城市“{normalized_city}”的地理位置。"

        location = results[0]
        latitude = location["latitude"]
        longitude = location["longitude"]
        display_name = location.get("name", normalized_city)
        country = location.get("country", "")
        weather = _fetch_json(
            "https://api.open-meteo.com/v1/forecast"
            f"?latitude={latitude}&longitude={longitude}&current=temperature_2m,wind_speed_10m,weather_code"
        )
        current = weather.get("current") or {}
        temperature = current.get("temperature_2m")
        wind_speed = current.get("wind_speed_10m")
        weather_code = current.get("weather_code")
        return f"{display_name}{f'（{country}）' if country else ''}当前气温 {temperature}℃，风速 {wind_speed} km/h，天气代码 {weather_code}。"
    except Exception:
        return "天气查询暂时失败，请稍后重试。"
