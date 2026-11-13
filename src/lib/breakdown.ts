/** Roadside help: what to do when the car stops.
 *
 * Three rules shaped every word below.
 *
 * 1. Safety before fixing. The app asks whether anyone is hurt and where the
 *    car is standing before it will show a single repair step. A puncture on
 *    the hard shoulder of the M1 is not a tyre problem, it is a danger of
 *    being hit, and the right answer there is to leave the wheel alone.
 *
 * 2. Nothing model-specific is invented. Procedures genuinely differ between
 *    cars — jack points, whether there is a spare at all, where the battery
 *    sits — and no free database publishes them. Every guide says plainly
 *    where the owner's manual is the only safe authority.
 *
 * 3. An honest stop. Each guide carries the conditions under which the right
 *    move is to stop and call someone, and those are shown before the steps,
 *    not buried after them.
 *
 * Mauritius drives on the left, so passing traffic is on the driver's side
 * and the kerb is on the passenger's. Every instruction about getting out of
 * a car reflects that.
 */

export type Powertrain = 'petrol-diesel' | 'hybrid' | 'electric' | 'unsure'

export type StoppedWhere = 'motorway' | 'main-road' | 'side-road' | 'safe-spot'

export const WHERE_LABEL: Record<StoppedWhere, string> = {
  motorway: 'On the motorway (M1, M2, M3)',
  'main-road': 'On a main road, traffic passing close',
  'side-road': 'On a quiet side road',
  'safe-spot': 'Fully off the road, car park or driveway',
}

/** The same thing phrased to sit mid-sentence. Lowercasing the label instead
 *  turned the road names into "m1, m2, m3". */
export const WHERE_PHRASE: Record<StoppedWhere, string> = {
  motorway: 'on the motorway',
  'main-road': 'on a main road with traffic passing close',
  'side-road': 'on a quiet side road',
  'safe-spot': 'fully off the road',
}

export const POWERTRAIN_LABEL: Record<Powertrain, string> = {
  'petrol-diesel': 'Petrol or diesel',
  hybrid: 'Hybrid',
  electric: 'Electric',
  unsure: 'Not sure',
}

/** Can a repair reasonably be attempted where the car is standing? */
export function canWorkOnCarHere(where: StoppedWhere): boolean {
  return where === 'safe-spot' || where === 'side-road'
}

export type Step = {
  text: string
  /** Shown alongside the step in a warning tone. */
  caution?: string
}

export type Guide = {
  id: string
  label: string
  /** One line, so someone scanning in a hurry can pick the right one. */
  blurb: string
  /** Read before touching anything. */
  before: string[]
  youNeed?: string[]
  steps: Step[]
  /** Conditions where the honest answer is to stop. Shown above the steps. */
  stopAndCall: string[]
  /** What only the manual can tell them. */
  manualSays?: string
}

export const GUIDES: Guide[] = [
  {
    id: 'flat-tyre',
    label: 'Flat tyre',
    blurb: 'A puncture, or the tyre pressure warning came on',
    before: [
      'The car must be on firm, level ground, out of the traffic lane, handbrake on and in gear or park.',
      'Everyone out through the kerb-side doors and behind a barrier or well off the road. Not sitting in the car, and not standing on the traffic side.',
      'Hazard lights on. If you carry a warning triangle, put it well back along the road, far enough that a driver coming round the last bend still has time to slow.',
    ],
    youNeed: [
      'The spare or the sealant kit, usually under the boot floor',
      'Jack and wheel brace',
      'The locking wheel-nut key if your car has one',
    ],
    stopAndCall: [
      'You are on the motorway, or traffic is passing close enough to feel it. Changing a wheel on the traffic side is one of the most dangerous things a driver can do.',
      'The ground is soft, loose or sloping. A jack can sink or slip.',
      'The nuts will not move, or the locking key is missing.',
      'The tyre is shredded, the sidewall is torn or the wheel itself is damaged.',
      'It is dark and you are not confident you can be seen.',
    ],
    steps: [
      {
        text: 'Open the boot floor and see what you actually have. Many cars built since about 2010 carry a sealant kit instead of a spare wheel.',
        caution: 'A sealant kit seals small tread punctures only. It will not fix a sidewall tear or a large gash.',
      },
      {
        text: 'With the wheel still on the ground, loosen each nut about a quarter turn. The ground stops the wheel spinning while you push.',
      },
      {
        text: 'Find the jack point. It is a reinforced pad under the sill, usually marked with a notch, arrow or triangle in the trim.',
        caution: 'Jacking anywhere else can crush the sill or let the car drop. If you cannot find the mark, stop and call.',
      },
      { text: 'Raise the car until the flat tyre is just clear of the ground, no higher.' },
      {
        text: 'Take the nuts off, swap the wheel, and start all the nuts by hand before tightening any of them.',
        caution: 'Never put any part of yourself under a car held up by a jack.',
      },
      {
        text: 'Tighten in a star pattern, opposite nut each time, rather than going round the circle. Then lower the car and tighten firmly in the same order.',
      },
      {
        text: 'If the spare is a narrow space-saver, check the sticker on it. These are usually limited to about 80 km/h and a short distance.',
      },
      { text: 'Get the puncture repaired or the tyre replaced soon. A spare is a way home, not a fix.' },
    ],
    manualSays: 'Where the jack points are, and whether your car carries a spare or a sealant kit.',
  },

  {
    id: 'wont-start',
    label: 'It will not start',
    blurb: 'Dead, clicking, or turning over without firing',
    before: [
      'Make sure the car is in park or neutral with the handbrake on before anything else.',
      'What you hear when you turn the key tells you most of it, so listen first.',
    ],
    youNeed: ['Jump leads and a second car, or a jump pack'],
    stopAndCall: [
      'Your car is hybrid or electric and the problem is with the high-voltage system. The orange cables carry enough voltage to kill. Never touch them, and never jump from them.',
      'The battery case is cracked, bulging or leaking, or you smell rotten eggs. That is escaping gas or acid.',
      'The engine turns over normally but will not fire. That is not the battery, and guessing further costs you time.',
      'You are on a motorway or in a live traffic lane.',
    ],
    steps: [
      {
        text: 'Nothing at all, no lights, no click: the battery is flat or a terminal is loose. Check both terminals are tight and clean before anything else.',
      },
      {
        text: 'A rapid clicking: the battery has enough for the lights but not enough to turn the starter. A jumpstart is worth trying.',
      },
      {
        text: 'It turns over steadily but never fires: the battery is fine. This is fuel, spark or an immobiliser, and it is a garage job.',
      },
      {
        text: 'To jumpstart, park the good car close but not touching, both engines off, both handbrakes on.',
      },
      {
        text: 'Red clamp to the flat battery positive, other red to the good battery positive. Black clamp to the good battery negative.',
      },
      {
        text: 'The last black clamp goes on bare metal on the engine block of the flat car, away from its battery. Not on the flat battery negative.',
        caution: 'A charging battery vents hydrogen. The last connection is the one that sparks, so it must be made away from the battery.',
      },
      { text: 'Start the good car, let it run two or three minutes, then try the flat one.' },
      {
        text: 'Once it starts, drive for at least twenty minutes or the battery will be flat again. Remove the leads in the reverse order.',
      },
      {
        text: 'If it goes flat again within a day or two, the battery or the charging system needs replacing, not recharging.',
      },
    ],
    manualSays: 'Where your battery is. On a good number of cars it is not under the bonnet, and some provide a dedicated jump terminal instead.',
  },

  {
    id: 'overheating',
    label: 'Overheating',
    blurb: 'Temperature gauge climbing, warning light, or steam',
    before: [
      'Turn the air conditioning off and the heater to full hot with the fan high. It feels wrong, but it pulls heat out of the engine.',
      'Pull over as soon as it is safe and switch the engine off. Every extra minute running risks a warped head and a bill in the tens of thousands of rupees.',
    ],
    stopAndCall: [
      'There is steam, spray, or a sweet smell. The system is pressurised and the coolant is well above boiling.',
      'There is a puddle under the car, or the level drops again soon after topping up. Something has failed.',
      'The oil warning light comes on as well.',
      'The temperature climbs again within a few minutes of setting off.',
    ],
    steps: [
      {
        text: 'Engine off. Leave the bonnet shut if you can see steam, and wait.',
      },
      {
        text: 'Never open the radiator cap or the expansion tank while the engine is hot.',
        caution: 'The coolant is under pressure and far above 100 degrees. Opening it releases a scalding spray. Wait at least thirty minutes, and longer if you can.',
      },
      {
        text: 'Once it is cool enough to rest your hand on the tank, check the level against the minimum and maximum marks on the side.',
      },
      {
        text: 'If it is low, top up with the right coolant. Clean water will get you home in an emergency, but it dilutes the protection and needs correcting soon.',
      },
      {
        text: 'Start up and watch the gauge. If it climbs again, switch off. Driving an overheating engine is how a small repair becomes a new engine.',
      },
    ],
    manualSays: 'Which coolant your engine takes. Mixing types can turn the coolant to sludge.',
  },

  {
    id: 'warning-light',
    label: 'A warning light came on',
    blurb: 'Work out whether to stop now or book it in',
    before: [
      'Colour tells you the urgency, and that part is standard across nearly every car.',
    ],
    stopAndCall: [
      'A red light is on and you cannot get safely off the road.',
      'The oil pressure light is on. Stop the engine. Driving on it can destroy the engine within minutes.',
      'The brake warning is on and the pedal feels long, soft or the car pulls when braking.',
    ],
    steps: [
      {
        text: 'Red means stop as soon as it is safe. Oil pressure, temperature, brakes, charging and airbag all use red.',
      },
      {
        text: 'The oil can symbol in red is not a low-oil reminder. It means the engine has lost oil pressure. Switch off immediately.',
        caution: 'This is the one light where carrying on, even a short distance, can write the engine off.',
      },
      {
        text: 'Amber means get it looked at soon. Engine management, ABS, tyre pressure and glow plugs are usually amber, and the car is usually drivable gently.',
      },
      {
        text: 'An engine light that is flashing rather than steady means a misfire happening right now. Ease off, keep the revs down and get it seen.',
        caution: 'A sustained misfire can destroy the catalytic converter, which is an expensive part.',
      },
      { text: 'Green and blue are information, not faults.' },
      {
        text: 'If a red light came on and then went out, it still happened. Mention it when the car is next serviced.',
      },
    ],
    manualSays: 'The exact symbol chart for your car. Manufacturers do vary, and a few use their own icons.',
  },

  {
    id: 'oil-check',
    label: 'Check the oil',
    blurb: 'How to read the dipstick properly',
    before: [
      'Engine off, car on level ground, and wait five to ten minutes after running so the oil drains back down.',
    ],
    stopAndCall: [
      'The red oil pressure light is on. That is not a level problem. Stop the engine and call.',
      'The oil is milky or looks like coffee with milk. That is coolant getting into the oil, and it needs a garage.',
    ],
    steps: [
      { text: 'Pull the dipstick out, wipe it clean, push it all the way back in, then pull it out again. The first reading is always wrong.' },
      { text: 'Read where the oil film ends. It should sit between the minimum and maximum marks.' },
      {
        text: 'If it is below minimum, add a little at a time and re-check. Give it a minute to drain down between top-ups.',
        caution: 'Over-filling is its own problem: too much oil gets whipped into foam and stops protecting the engine.',
      },
      { text: 'Oil that is gritty, or smells burnt, or is well past its service interval, needs changing rather than topping up.' },
    ],
    manualSays: 'The oil grade your engine needs. Putting in the wrong viscosity does real harm over time.',
  },

  {
    id: 'out-of-fuel',
    label: 'Out of fuel',
    blurb: 'Ran dry, or the gauge is on empty and it cut out',
    before: ['Get the car as far off the road as it will roll, and the people well clear of traffic.'],
    stopAndCall: [
      'The car is diesel. Running a diesel dry usually draws air into the fuel system, and most need bleeding before they will restart. That is a garage job.',
      'You are on a motorway. Walking on one is illegal and extremely dangerous.',
    ],
    steps: [
      { text: 'Stop cranking. Turning the engine over on an empty tank wears the starter and can damage the fuel pump, which relies on fuel to stay cool.' },
      { text: 'If it is petrol and someone can bring you fuel, put in at least five litres before trying again, and expect a few seconds of cranking.' },
      {
        text: 'Think hard before walking to a filling station. On a Mauritian main road after dark, walking is the more dangerous option.',
        caution: 'Half of everyone hurt on these roads is on foot or on two wheels. Waiting in a safe place beats walking.',
      },
    ],
  },

  {
    id: 'smoke-or-smell',
    label: 'Smoke, burning or a fuel smell',
    blurb: 'Stop reading and get everyone out',
    before: [
      'This one has no repair steps. Fire in a car spreads in seconds and the fuel tank is part of the car.',
    ],
    stopAndCall: [
      'Always. Get everyone out and well away, at least a hundred paces, upwind, and behind a barrier if there is one.',
      'Call the fire service on 115, and 999 if the road is blocked.',
    ],
    steps: [
      {
        text: 'Do not open the bonnet if you think there is fire behind it.',
        caution: 'Lifting the bonnet feeds the fire a rush of air. Leave it shut.',
      },
      { text: 'Leave everything in the car. Nothing in it is worth going back for.' },
      { text: 'Keep other people back too. Tyres and struts can burst.' },
    ],
  },
]

export const GUIDE_BY_ID = Object.fromEntries(GUIDES.map((g) => [g.id, g]))

/** Warnings that come from the powertrain, which the rider tells us because
 *  no free database reliably says whether a given model is a hybrid. */
export function powertrainWarnings(p: Powertrain, guideId: string): string[] {
  const out: string[] = []
  if ((p === 'hybrid' || p === 'electric') && guideId === 'wont-start') {
    out.push(
      'Orange cables are high voltage. Never touch them, never cut them and never jump from them. A hybrid usually has a separate small 12 volt battery that can be jumped, but the terminals and the procedure differ by model, so check the manual first.',
    )
  }
  if (p === 'electric' && guideId === 'out-of-fuel') {
    out.push('An electric car that has run flat needs recovery. It cannot be charged at the roadside from a can.')
  }
  if ((p === 'hybrid' || p === 'electric') && guideId === 'smoke-or-smell') {
    out.push(
      'A high-voltage battery fire behaves differently from a petrol fire. It can reignite hours later. Tell the fire service it is a hybrid or electric car when you call.',
    )
  }
  if (p === 'unsure' && guideId === 'wont-start') {
    out.push(
      'If you are not sure whether your car is a hybrid, look for orange cabling under the bonnet or a charging socket. If you see either, do not jump it without the manual.',
    )
  }
  return out
}

/** What to do while waiting, which changes a lot with where the car stopped. */
export function waitingAdvice(where: StoppedWhere, isDark: boolean): string[] {
  const out: string[] = ['Hazard lights on and leave them on.']

  if (where === 'motorway' || where === 'main-road') {
    out.push(
      'Everyone out through the kerb-side doors. In Mauritius traffic passes on the driver’s side, so that is the side to keep away from.',
      'Stand behind a barrier or well back from the road, ahead of the car rather than behind it, so a vehicle that hits yours does not hit you too.',
      'Do not stand between your car and oncoming traffic, and do not try a repair on the traffic side.',
    )
  } else {
    out.push('Get the car as far off the carriageway as it will go before doing anything else.')
  }

  if (isDark) {
    out.push(
      'After dark, be seen: interior light on, phone torch on, light colours or anything reflective. On an unlit road a stopped car is almost invisible until the last moment.',
    )
  }
  return out
}
