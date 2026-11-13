/** Shapes of the JSON in public/data, all produced by scripts/build_app_data.py. */

export type Source = {
  dataset: string
  resource: string | null
  url: string | null
  licence: string | null
  publisher: string
  rows: number | null
}

export type Place = {
  id: string
  name: string
  district: string
  policeDistricts: string[]
  lat: number
  lon: number
  facilityCount: number
}

export type Hotspot = {
  id: string
  name: string
  road: string | null
  label: string
  points: [number, number][]
  mid: [number, number]
  lengthKm: number
}

export type District = {
  name: string
  year: number
  casualtyAccidents: number
  pedestrianCasualties: number
  riderCasualties: number
  otherCasualties: number
  totalCasualties: number
  pedestrianShare: number
  riderShare: number
  otherShare: number
  changeVsPrevYear: number | null
  pressureIndex: number
  history: [number, number][]
}

export type LightCondition = {
  condition: string
  casualties: number
  fatal: number
  serious: number
  fatalShare: number
  seriousOrFatalShare: number
  isDark: boolean
}

export type JunctionType = {
  junctionType: string
  accidents: number
  fatal: number
  fatalShare: number
}

export type RoadType = {
  roadType: string
  accidents: number
  fatalShare: number
  hitPedestrian: number
  hitPedestrianShare: number
}

export type WeatherCondition = {
  condition: string
  accidents: number
  fatal: number
  fatalShare: number
  /** False when too few accidents were recorded to quote the share as fact. */
  reliable: boolean
  fatalRatioVsFine: number | null
}

export type EmergencyPlace = {
  id: string
  kind: 'hospital' | 'clinic' | 'police'
  category: string
  name: string
  town: string
  district: string | null
  phone: string | null
  lat: number
  lon: number
}

export type AppData = {
  places: { places: Place[]; policeDistrictMapping: Record<string, string[]>; note: string; sources: Source[] }
  hotspots: {
    hotspots: Hotspot[]
    corridorRadiusKm: number
    scale: { p90Count: number; medianCount: number; maxCount: number; corridorsMeasured: number; note: string }
    note: string
    sources: Source[]
  }
  districts: {
    year: number
    districts: District[]
    islandTotals: Record<string, number>
    sources: Source[]
  }
  conditions: {
    light: { year: number; conditions: LightCondition[] }
    junctions: { year: number; types: JunctionType[] }
    roads: { year: number; types: RoadType[] }
    weather: { years: number[]; pooled: boolean; conditions: WeatherCondition[] }
    sources: Source[]
  }
  emergency: { places: EmergencyPlace[]; counts: Record<string, number>; sources: Source[] }
  exposure: {
    vehicleYear: number
    casualtyYear: number
    registeredTotal: number
    twoWheelRegistered: number
    twoWheelVehicleShare: number
    riderCasualtyShare: number
    pedestrianCasualtyShare: number
    vulnerableShare: number
    riderCasualtiesPer1000Vehicles: number
    occupantCasualtiesPer1000Vehicles: number
    riderRiskRatio: number | null
    byType: Record<string, number>
    sources: Source[]
  }
  island: {
    year: number
    accidents?: number
    fatal?: number
    seriously?: number
    slightly?: number
    casualties: number
    sources: Source[]
  }
}

/** How the traveller is moving. Drives which casualty group we score against. */
export type TravelMode = 'car' | 'motorcycle' | 'bus' | 'pedestrian'

/** Light condition at the time of travel, matching the official categories. */
export type TimeBand = 'day' | 'dawn-dusk' | 'night-lit' | 'night-unlit'
