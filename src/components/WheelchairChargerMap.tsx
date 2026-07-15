import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import L from 'leaflet'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { BatteryCharging, Database, LoaderCircle, MapPin } from 'lucide-react'
import locationCsvUrl from '../../data/location.csv?url'
import 'leaflet/dist/leaflet.css'
import './WheelchairChargerMap.css'

type CsvRow = Record<string, string>
type ChargerProperties = CsvRow & {
  __region: string
  __name: string
  __address: string
}

const REGION_FIELDS = ['시도명', '시도', '광역시도', '지역', '지역명']
const ADDRESS_FIELDS = ['소재지도로명주소', '소재지지번주소', '도로명주소', '지번주소', '주소', '설치장소주소']
const NAME_FIELDS = ['시설명', '충전소명', '설치장소', '장소명', '충전기명', '기관명']

const getFirstValue = (row: CsvRow, fields: string[]) => fields.map((field) => row[field]?.trim()).find(Boolean) ?? ''

const normalizeRegion = (value: string) => {
  const firstWord = value.trim().split(/\s+/)[0] ?? ''
  const aliases: Record<string, string> = {
    서울특별시: '서울특별시', 부산광역시: '부산광역시', 대구광역시: '대구광역시', 인천광역시: '인천광역시',
    광주광역시: '광주광역시', 대전광역시: '대전광역시', 울산광역시: '울산광역시', 세종특별자치시: '세종특별자치시',
    경기도: '경기도', 강원특별자치도: '강원특별자치도', 강원도: '강원특별자치도', 충청북도: '충청북도', 충청남도: '충청남도',
    전북특별자치도: '전북특별자치도', 전라북도: '전북특별자치도', 전라남도: '전라남도', 경상북도: '경상북도',
    경상남도: '경상남도', 제주특별자치도: '제주특별자치도', 제주도: '제주특별자치도',
  }
  return aliases[firstWord] ?? (firstWord || '지역 미분류')
}

const normalizeRow = (row: CsvRow) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [key.replace(/^\uFEFF/, '').trim(), String(value ?? '').trim()]),
)

const parseCoordinate = (value: string) => Number(value.replace(/,/g, '').trim())

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character] ?? character))

async function readCsv() {
  const response = await fetch(locationCsvUrl)
  if (!response.ok) throw new Error('location.csv 파일을 불러오지 못했습니다.')
  const bytes = await response.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

function FitGeoJsonBounds({ data }: { data: FeatureCollection<Point, ChargerProperties> }) {
  const map = useMap()
  useEffect(() => {
    if (!data.features.length) {
      map.setView([36.35, 127.85], 7)
      return
    }
    const bounds = L.latLngBounds(data.features.map((feature) => [
      feature.geometry.coordinates[1],
      feature.geometry.coordinates[0],
    ]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
  }, [data, map])
  return null
}

export default function WheelchairChargerMap() {
  const [geoJson, setGeoJson] = useState<FeatureCollection<Point, ChargerProperties>>({ type: 'FeatureCollection', features: [] })
  const [selectedRegion, setSelectedRegion] = useState('전체')
  const [invalidCount, setInvalidCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const csv = await readCsv()
        const parsed = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true })
        if (parsed.errors.length && !parsed.data.length) throw new Error(parsed.errors[0].message)

        let invalidRows = 0
        const features: Array<Feature<Point, ChargerProperties>> = []
        for (const originalRow of parsed.data) {
          const row = normalizeRow(originalRow)
          const latitude = parseCoordinate(row['위도'] ?? '')
          const longitude = parseCoordinate(row['경도'] ?? '')
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            invalidRows += 1
            continue
          }
          const address = getFirstValue(row, ADDRESS_FIELDS)
          const region = normalizeRegion(getFirstValue(row, REGION_FIELDS) || address)
          const name = getFirstValue(row, NAME_FIELDS) || '전동휠체어 급속충전기'
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [longitude, latitude] },
            properties: { ...row, __region: region, __name: name, __address: address },
          })
        }
        setGeoJson({ type: 'FeatureCollection', features })
        setInvalidCount(invalidRows)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '위치 데이터를 읽는 중 문제가 발생했습니다.')
      } finally {
        setLoading(false)
      }
    }
    void loadLocations()
  }, [])

  const regions = useMemo(() => ['전체', ...Array.from(new Set(geoJson.features.map((feature) => feature.properties.__region))).sort((a, b) => a.localeCompare(b, 'ko'))], [geoJson])
  const filteredGeoJson = useMemo<FeatureCollection<Point, ChargerProperties>>(() => ({
    type: 'FeatureCollection',
    features: selectedRegion === '전체' ? geoJson.features : geoJson.features.filter((feature) => feature.properties.__region === selectedRegion),
  }), [geoJson, selectedRegion])

  return (
    <main className="charger-page">
      <aside className="charger-sidebar">
        <div className="charger-symbol"><BatteryCharging size={25} /></div>
        <p className="eyebrow">ACCESSIBLE MAP</p>
        <h1>전국 전동휠체어<br />급속충전기 위치</h1>
        <label htmlFor="region-select">지역 선택</label>
        <select id="region-select" value={selectedRegion} onChange={(event) => setSelectedRegion(event.target.value)} disabled={loading || Boolean(error)}>
          {regions.map((region) => <option key={region} value={region}>{region}</option>)}
        </select>
        <div className="charger-stats"><MapPin size={16} /><span><strong>{filteredGeoJson.features.length.toLocaleString()}</strong>개 위치 표시 중</span></div>
        <div className="charger-source"><Database size={14} /><span>data/location.csv<br />GeoJSON · EPSG:4326</span></div>
        {invalidCount > 0 && <p className="invalid-rows">좌표 오류 {invalidCount}개 행 제외</p>}
      </aside>

      <section className="charger-map-wrap">
        <MapContainer center={[36.35, 127.85]} zoom={7} scrollWheelZoom preferCanvas className="charger-map">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {filteredGeoJson.features.length > 0 && <GeoJSON
            key={`${selectedRegion}-${filteredGeoJson.features.length}`}
            data={filteredGeoJson}
            pointToLayer={(_feature, latlng) => L.circleMarker(latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#176b49', fillOpacity: .9 })}
            onEachFeature={(feature, layer) => {
              const properties = feature.properties as ChargerProperties
              if (feature.geometry.type !== 'Point') return
              const [longitude, latitude] = feature.geometry.coordinates
              layer.bindPopup(`<div class="charger-popup"><strong>${escapeHtml(properties.__name)}</strong>${properties.__address ? `<span>${escapeHtml(properties.__address)}</span>` : ''}<small>위도 ${latitude} · 경도 ${longitude}</small></div>`)
            }}
          />}
          <FitGeoJsonBounds data={filteredGeoJson} />
        </MapContainer>
        {loading && <div className="map-message"><LoaderCircle className="spinner" size={29} /><strong>위치 데이터를 불러오는 중입니다.</strong></div>}
        {!loading && error && <div className="map-message error"><MapPin size={30} /><strong>지도를 표시할 수 없습니다.</strong><span>{error}</span></div>}
        {!loading && !error && geoJson.features.length === 0 && <div className="map-message"><MapPin size={30} /><strong>표시할 위치 데이터가 없습니다.</strong><span>data/location.csv 파일에 위치 데이터를 추가해 주세요.</span></div>}
      </section>
    </main>
  )
}
