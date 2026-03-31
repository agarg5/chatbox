import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'

interface PostMessage {
  type: string
  toolName?: string
  params?: Record<string, unknown>
  invocationId?: string
  result?: Record<string, unknown>
}

interface WeatherData {
  location: string
  temperature: number
  condition: string
  conditionIcon: string
  windSpeed: number
  humidity: number
}

interface ForecastDay {
  date: string
  high: number
  low: number
  condition: string
  conditionIcon: string
}

function weatherCodeToInfo(code: number): { description: string; icon: string } {
  const map: Record<number, { description: string; icon: string }> = {
    0: { description: 'Clear sky', icon: '☀️' },
    1: { description: 'Mainly clear', icon: '🌤️' },
    2: { description: 'Partly cloudy', icon: '⛅' },
    3: { description: 'Overcast', icon: '☁️' },
    45: { description: 'Foggy', icon: '🌫️' },
    48: { description: 'Depositing rime fog', icon: '🌫️' },
    51: { description: 'Light drizzle', icon: '🌦️' },
    53: { description: 'Moderate drizzle', icon: '🌦️' },
    55: { description: 'Dense drizzle', icon: '🌧️' },
    61: { description: 'Slight rain', icon: '🌧️' },
    63: { description: 'Moderate rain', icon: '🌧️' },
    65: { description: 'Heavy rain', icon: '🌧️' },
    71: { description: 'Slight snow', icon: '🌨️' },
    73: { description: 'Moderate snow', icon: '🌨️' },
    75: { description: 'Heavy snow', icon: '❄️' },
    80: { description: 'Rain showers', icon: '🌦️' },
    81: { description: 'Moderate rain showers', icon: '🌧️' },
    82: { description: 'Violent rain showers', icon: '⛈️' },
    85: { description: 'Snow showers', icon: '🌨️' },
    86: { description: 'Heavy snow showers', icon: '❄️' },
    95: { description: 'Thunderstorm', icon: '⛈️' },
    96: { description: 'Thunderstorm with hail', icon: '⛈️' },
    99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' },
  }
  return map[code] || { description: 'Unknown', icon: '❓' }
}

async function geocode(location: string) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`)
  const data = await res.json()
  if (!data.results?.length) return null
  const r = data.results[0]
  return { lat: r.latitude, lon: r.longitude, name: `${r.name}, ${r.country}` }
}

async function fetchCurrentWeather(lat: number, lon: number) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
  )
  const data = await res.json()
  return {
    temperature: data.current.temperature_2m,
    weatherCode: data.current.weather_code,
    windSpeed: data.current.wind_speed_10m,
    humidity: data.current.relative_humidity_2m,
  }
}

async function fetchForecast(lat: number, lon: number, days = 7) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=${days}`
  )
  const data = await res.json()
  return data.daily.time.map((date: string, i: number) => ({
    date,
    weatherCode: data.daily.weather_code[i],
    high: data.daily.temperature_2m_max[i],
    low: data.daily.temperature_2m_min[i],
  }))
}

export const Route = createFileRoute('/apps/weather/')({
  component: WeatherApp,
})

function WeatherApp() {
  const [currentWeather, setCurrentWeather] = useState<WeatherData | null>(null)
  const [forecast, setForecast] = useState<ForecastDay[]>([])
  const [searchCity, setSearchCity] = useState('')
  const [loading, setLoading] = useState(false)

  const sendToParent = useCallback((msg: PostMessage) => {
    if (window.parent !== window) window.parent.postMessage(msg, window.location.origin)
  }, [])

  const loadWeather = useCallback(async (location: string) => {
    setLoading(true)
    try {
      const geo = await geocode(location)
      if (!geo) { setLoading(false); return null }

      const current = await fetchCurrentWeather(geo.lat, geo.lon)
      const info = weatherCodeToInfo(current.weatherCode)
      const weatherData: WeatherData = {
        location: geo.name,
        temperature: Math.round(current.temperature),
        condition: info.description,
        conditionIcon: info.icon,
        windSpeed: Math.round(current.windSpeed),
        humidity: current.humidity,
      }
      setCurrentWeather(weatherData)

      const forecastData = await fetchForecast(geo.lat, geo.lon)
      const forecastDays: ForecastDay[] = forecastData.map((d: any) => {
        const fInfo = weatherCodeToInfo(d.weatherCode)
        return { date: d.date, high: Math.round(d.high), low: Math.round(d.low), condition: fInfo.description, conditionIcon: fInfo.icon }
      })
      setForecast(forecastDays)
      setLoading(false)
      return { current: weatherData, forecast: forecastDays }
    } catch (err) {
      console.error('Weather fetch error:', err)
      setLoading(false)
      return null
    }
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const msg = event.data as PostMessage
      if (msg.type !== 'TOOL_INVOKE') return
      const { toolName, params, invocationId } = msg

      if (toolName === 'get_current_weather') {
        const location = params?.location as string
        if (!location) {
          sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'Location is required' } })
          return
        }
        loadWeather(location).then((data) => {
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: data
              ? { location: data.current.location, temperature: data.current.temperature, temperatureUnit: '°F', condition: data.current.condition, windSpeed: data.current.windSpeed, windUnit: 'mph', humidity: data.current.humidity }
              : { error: `Could not find weather for "${location}"` },
          })
        })
      } else if (toolName === 'get_forecast') {
        const location = params?.location as string
        const days = (params?.days as number) || 7
        if (!location) {
          sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'Location is required' } })
          return
        }
        geocode(location).then(async (geo) => {
          if (!geo) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: `Could not find location "${location}"` } })
            return
          }
          const forecastData = await fetchForecast(geo.lat, geo.lon, days)
          const forecastDays = forecastData.map((d: any) => {
            const fInfo = weatherCodeToInfo(d.weatherCode)
            return { date: d.date, high: Math.round(d.high), low: Math.round(d.low), condition: fInfo.description }
          })
          setForecast(forecastData.map((d: any) => {
            const fInfo = weatherCodeToInfo(d.weatherCode)
            return { date: d.date, high: Math.round(d.high), low: Math.round(d.low), condition: fInfo.description, conditionIcon: fInfo.icon }
          }))
          sendToParent({ type: 'TOOL_RESULT', invocationId, result: { location: geo.name, forecast: forecastDays } })
        })
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [sendToParent, loadWeather])

  useEffect(() => { sendToParent({ type: 'READY' }) }, [sendToParent])

  const handleSearch = () => { if (searchCity.trim()) loadWeather(searchCity.trim()) }

  return (
    <div className="min-h-screen bg-zinc-900 p-6">
      <h2 className="text-xl font-bold text-white mb-4">Weather Dashboard</h2>
      <div className="flex gap-2 mb-6">
        <input type="text" value={searchCity} onChange={(e) => setSearchCity(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Search city..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500" />
        <button type="button" onClick={handleSearch} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{loading ? '...' : 'Search'}</button>
      </div>
      {currentWeather && (
        <div className="bg-zinc-800 rounded-lg p-6 mb-6 border border-zinc-700">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg text-zinc-400">{currentWeather.location}</h3>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-5xl">{currentWeather.conditionIcon}</span>
                <span className="text-5xl font-bold text-white">{currentWeather.temperature}°F</span>
              </div>
              <p className="text-zinc-400 mt-1">{currentWeather.condition}</p>
            </div>
            <div className="text-right text-sm text-zinc-400 space-y-1">
              <p>Wind: {currentWeather.windSpeed} mph</p>
              <p>Humidity: {currentWeather.humidity}%</p>
            </div>
          </div>
        </div>
      )}
      {forecast.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-3">7-Day Forecast</h3>
          <div className="grid grid-cols-7 gap-2">
            {forecast.map((day) => (
              <div key={day.date} className="bg-zinc-800 rounded-lg p-3 border border-zinc-700 text-center">
                <p className="text-xs text-zinc-500">{new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</p>
                <p className="text-2xl my-2">{day.conditionIcon}</p>
                <p className="text-sm text-white font-medium">{day.high}°</p>
                <p className="text-xs text-zinc-500">{day.low}°</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {!currentWeather && !loading && (
        <div className="text-center text-zinc-500 mt-12">
          <p className="text-lg">No weather data</p>
          <p className="text-sm mt-1">Ask the chatbot about weather or search a city above</p>
        </div>
      )}
    </div>
  )
}
