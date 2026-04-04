import { clamp, VALID_ALLIANCE, VALID_ENDGAME, toBool } from '@3749/shared/src/index.js';
// import { callSmolLM } from './lemonade-client.js';

const SYSTEM_PROMPT = `You are SCOUT-NORM, a precise FRC scouting data normalizer for Team 3749.
Return JSON only.`;

const UNKNOWN = 'unknown';

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const parseLeadingZeroNumber = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (/^0\d+$/.test(text)) {
    return Number.parseInt(text.replace(/^0+(?=\d)/, ''), 10) || 0;
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
};
const normalizeOptionalText = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

const normalizeMotorType = (value) => {
  const text = normalizeText(value);
  if (!text) return UNKNOWN;

  if (text.includes('kraken') || text.includes('x60')) return 'kraken_x60';
  if (text.includes('falcon')) return 'falcon_500';
  if (text.includes('neo 550') || text.includes('neo550')) return 'neo_550';
  if (text.includes('neo vortex') || text.includes('vortex')) return 'neo_vortex';
  if (text.includes('neo')) return 'neo';
  if (text.includes('minicim') || text.includes('mini cim')) return 'mini_cim';
  if (text.includes('cim')) return 'cim';
  if (text.includes('bag')) return 'bag';
  if (text.includes('775')) return '775pro';

  return text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || UNKNOWN;
};

const normalizeDrivetrain = (value) => {
  const text = normalizeText(value);
  if (!text) return UNKNOWN;
  if (text.includes('swerve')) return 'swerve';
  if (text.includes('mecanum')) return 'mecanum';
  if (text.includes('tank') || text.includes('west coast') || text.includes('wcd')) return 'tank';
  if (text.includes('h-drive') || text.includes('h drive')) return 'h_drive';
  if (text.includes('x-drive') || text.includes('x drive')) return 'x_drive';
  return UNKNOWN;
};

const normalizeVisionType = (value, fallbackText = '') => {
  const text = normalizeText(`${value || ''} ${fallbackText || ''}`);
  if (!text) return UNKNOWN;
  if (text.includes('limelight')) return 'limelight';
  if (text.includes('photon')) return 'photonvision';
  if (text.includes('apriltag') || text.includes('april tag')) return 'apriltag';
  if (text.includes('pixy')) return 'pixy';
  if (text.includes('none') || text.includes('no vision')) return 'none';
  return text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || UNKNOWN;
};

const normalizeCycleSpeed = (value, bps) => {
  const text = normalizeText(value);
  if (text === 'slow' || text === 'medium' || text === 'fast' || text === 'elite') return text;
  if (bps >= 7) return 'elite';
  if (bps >= 5) return 'fast';
  if (bps >= 2.5) return 'medium';
  if (bps > 0) return 'slow';
  return UNKNOWN;
};

const normalizeClimbCapability = (value, fallbackClimberType = '') => {
  const text = normalizeText(`${value || ''} ${fallbackClimberType || ''}`);
  if (!text) return UNKNOWN;
  if (text.includes('none') || text.includes('no climb')) return 'none';
  if (text.includes('park')) return 'park';
  if (text.includes('shallow')) return 'shallow';
  if (text.includes('deep') || text.includes('stage') || text.includes('cage')) return 'deep';
  if (text.includes('assisted')) return 'assisted';
  return text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || UNKNOWN;
};

const normalizeMechanismType = (value, aliases) => {
  const text = normalizeText(value);
  if (!text) return UNKNOWN;

  for (const [label, checks] of aliases) {
    if (checks.some((entry) => text.includes(entry))) return label;
  }

  return UNKNOWN;
};

const inferBoolean = (value, fallbackText = '') => {
  const raw = normalizeText(value);
  const text = `${raw} ${normalizeText(fallbackText)}`;
  if (!text.trim()) return false;
  if (/(^|\s)(yes|true|y|1|can|does|able)(\s|$)/.test(text)) return true;
  if (/(^|\s)(no|false|n|0|cannot|can't|cant)(\s|$)/.test(text)) return false;
  return /trench|bump|ground|source/.test(text);
};

function normalizePitLocally(raw) {
  const notes = String(raw.notes || raw.mechanism_notes || '').trim();
  const confidenceBase = [];

  const hopperCapacity = clamp(Number(raw.hopper_capacity || raw.hopperCapacity || 0), 0, 99);
  if (hopperCapacity > 0) confidenceBase.push(1);

  const drivetrainType = normalizeDrivetrain(raw.drivetrain_type || raw.drivetrain || notes);
  if (drivetrainType !== UNKNOWN) confidenceBase.push(1);
  const swerveModuleType = normalizeOptionalText(raw.swerve_module_type || raw.swerveModuleType);
  const swerveGearing = normalizeOptionalText(raw.swerve_gearing || raw.swerveGearing);

  const intakeType = normalizeMechanismType(raw.intake_type || raw.intake || notes, [
    ['roller_ground', ['ground', 'roller', 'floor'] ],
    ['outpost_station', ['outpost', 'station', 'source'] ],
    ['over_bumper', ['over bumper', 'over-bumper'] ],
    ['under_bumper', ['under bumper', 'under-bumper'] ]
  ]);
  if (intakeType !== UNKNOWN) confidenceBase.push(1);

  const shooterType = normalizeMechanismType(raw.shooter_type || raw.shooter || notes, [
    ['flywheel', ['flywheel', 'wheel shooter'] ],
    ['drum', ['drum'] ],
    ['catapult', ['catapult'] ],
    ['puncher', ['puncher', 'plunger'] ],
    ['pivoting_flywheel', ['turret', 'pivot', 'hood'] ]
  ]);
  if (shooterType !== UNKNOWN) confidenceBase.push(1);

  const climberType = normalizeMechanismType(raw.climber_type || raw.climber || notes, [
    ['telescoping', ['telescoping', 'elevator'] ],
    ['hook', ['hook', 'single arm'] ],
    ['multi_stage', ['multi', '2 stage', '3 stage'] ],
    ['none', ['none', 'no climb', 'no climber'] ]
  ]);
  if (climberType !== UNKNOWN) confidenceBase.push(1);
  const climbCapability = normalizeClimbCapability(raw.climb_capability || raw.climbCapability, climberType);

  const cycleBallsPerSec = clamp(Number(raw.cycle_balls_per_sec || raw.balls_per_second || 0), 0, 25);
  if (cycleBallsPerSec > 0) confidenceBase.push(1);
  const cycleSpeed = normalizeCycleSpeed(raw.cycle_speed || raw.cycleSpeed, cycleBallsPerSec);

  const visionType = normalizeVisionType(raw.vision_type || raw.visionType, notes);
  if (visionType !== UNKNOWN) confidenceBase.push(1);

  const outpostCapability = inferBoolean(raw.outpost_capability || raw.outpost, `${raw.intake_type || ''} ${notes}`);
  const depotCapability = inferBoolean(raw.depot_capability || raw.depot, `${raw.intake_type || ''} ${notes}`);

  const autoPaths = normalizeOptionalText(raw.auto_paths || raw.autoPaths);
  const softwareFeatures = normalizeOptionalText(raw.software_features || raw.softwareFeatures);
  const mechanicalFeatures = normalizeOptionalText(raw.mechanical_features || raw.mechanicalFeatures);

  const driveMotorType = normalizeMotorType(raw.drive_motor_type || raw.drive_motors || notes);
  const shooterMotorType = normalizeMotorType(raw.shooter_motor_type || raw.shooter_motors || notes);
  const intakeMotorType = normalizeMotorType(raw.intake_motor_type || raw.intake_motors || notes);
  const climberMotorType = normalizeMotorType(raw.climber_motor_type || raw.climber_motors || notes);

  const hasGroundIntake = inferBoolean(raw.has_ground_intake, `${raw.intake_type || ''} ${notes}`);
  const hasSourceIntake = inferBoolean(raw.has_source_intake, `${raw.intake_type || ''} ${notes}`);

  const canUseTrench = inferBoolean(raw.can_use_trench || raw.using_trench, notes);
  const canCrossBump = inferBoolean(raw.can_cross_bump || raw.using_bump, notes);

  const tags = [
    drivetrainType,
    intakeType,
    shooterType,
    climberType,
    canUseTrench ? 'trench_capable' : null,
    canCrossBump ? 'bump_capable' : null,
    outpostCapability ? 'outpost_capable' : null,
    depotCapability ? 'depot_capable' : null,
    hasGroundIntake ? 'ground_intake' : null,
    hasSourceIntake ? 'source_intake' : null,
    visionType !== UNKNOWN ? `vision_${visionType}` : null,
    cycleSpeed !== UNKNOWN ? `cycle_${cycleSpeed}` : null,
    climbCapability !== UNKNOWN ? `climb_${climbCapability}` : null,
    driveMotorType !== UNKNOWN ? `drive_${driveMotorType}` : null,
    shooterMotorType !== UNKNOWN ? `shooter_${shooterMotorType}` : null,
    intakeMotorType !== UNKNOWN ? `intake_${intakeMotorType}` : null,
    climberMotorType !== UNKNOWN ? `climber_${climberMotorType}` : null
  ].filter((tag) => tag && tag !== UNKNOWN);

  const confidence_score = clamp((confidenceBase.length + Math.min(tags.length, 8) * 0.2) / 6, 0.45, 0.99);

  return {
    event_key: String(raw.eventKey || raw.event_key || ''),
    team_number: clamp(parseLeadingZeroNumber(raw.team_number || raw.teamNumber || 0), 0, 99999),
    scout_name: String(raw.scoutName || raw.scout_name || 'unknown').trim() || 'unknown',
    hopper_capacity: hopperCapacity > 0 ? hopperCapacity : null,
    drivetrain_type: drivetrainType,
    swerve_module_type: swerveModuleType,
    swerve_gearing: swerveGearing,
    can_use_trench: canUseTrench,
    can_cross_bump: canCrossBump,
    cycle_balls_per_sec: cycleBallsPerSec > 0 ? Number(cycleBallsPerSec.toFixed(2)) : 0,
    cycle_speed: cycleSpeed,
    outpost_capability: outpostCapability,
    depot_capability: depotCapability,
    intake_type: intakeType,
    shooter_type: shooterType,
    vision_type: visionType,
    auto_paths: autoPaths,
    climber_type: climberType,
    climb_capability: climbCapability,
    has_ground_intake: hasGroundIntake,
    has_source_intake: hasSourceIntake,
    drive_motor_type: driveMotorType,
    shooter_motor_type: shooterMotorType,
    intake_motor_type: intakeMotorType,
    climber_motor_type: climberMotorType,
    software_features: softwareFeatures,
    mechanical_features: mechanicalFeatures,
    mechanism_notes: notes || null,
    ai_tags: tags,
    confidence_score,
    warnings: []
  };
}

function normalizeLocally(raw) {
  const alliance = VALID_ALLIANCE.has(raw.alliance_color) ? raw.alliance_color : 'red';
  const endgame = VALID_ENDGAME.has(raw.endgame_result) ? raw.endgame_result : 'none';

  return {
    team_number: clamp(parseLeadingZeroNumber(raw.team_number || 0), 0, 99999),
    match_number: clamp(parseLeadingZeroNumber(raw.match_number || 0), 0, 999),
    alliance_color: alliance,
    auto_fuel_auto: clamp(Number(raw.auto_fuel_auto || 0), 0, 99),
    auto_fuel_missed: clamp(Number(raw.auto_fuel_missed || 0), 0, 99),
    auto_tower_climb: clamp(Number(raw.auto_tower_climb || 0), 0, 1),
    auto_mobility: toBool(raw.auto_mobility),
    auto_hub_shift_won: toBool(raw.auto_hub_shift_won),
    teleop_fuel_scored: clamp(Number(raw.teleop_fuel_scored || 0), 0, 200),
    teleop_fuel_missed: clamp(Number(raw.teleop_fuel_missed || 0), 0, 200),
    teleop_defense_rating: clamp(Number(raw.teleop_defense_rating || 0), 0, 5),
    teleop_speed_rating: clamp(Number(raw.teleop_speed_rating || 0), 0, 5),
    teleop_crossed_bump: toBool(raw.teleop_crossed_bump),
    teleop_crossed_trench: toBool(raw.teleop_crossed_trench),
    endgame_result: endgame,
    endgame_attempted_climb: toBool(raw.endgame_attempted_climb),
    robot_disabled: toBool(raw.robot_disabled),
    robot_tipped: toBool(raw.robot_tipped),
    fouls_committed: clamp(Number(raw.fouls_committed || 0), 0, 20),
    confidence_score: 0.75,
    warnings: []
  };
}

export async function normalizeMatchSubmission(raw) {
  try {
    // Temporarily disable Lemonade AI normalization to avoid local model runtime usage.
    // const ai = await callSmolLM(SYSTEM_PROMPT, JSON.stringify(raw), true);
    // const merged = { ...normalizeLocally(raw), ...ai };
    const merged = normalizeLocally(raw);

    merged.teleop_defense_rating = clamp(Number(merged.teleop_defense_rating || 0), 0, 5);
    merged.teleop_speed_rating = clamp(Number(merged.teleop_speed_rating || 0), 0, 5);
    merged.auto_fuel_auto = clamp(Number(merged.auto_fuel_auto || 0), 0, 99);
    merged.auto_fuel_missed = clamp(Number(merged.auto_fuel_missed || 0), 0, 99);
    merged.teleop_fuel_scored = clamp(Number(merged.teleop_fuel_scored || 0), 0, 200);
    merged.teleop_fuel_missed = clamp(Number(merged.teleop_fuel_missed || 0), 0, 200);
    merged.fouls_committed = clamp(Number(merged.fouls_committed || 0), 0, 20);
    merged.confidence_score = clamp(Number(merged.confidence_score || 0.7), 0, 1);
    if (!Array.isArray(merged.warnings)) merged.warnings = [];

    if (!VALID_ALLIANCE.has(merged.alliance_color)) merged.alliance_color = 'red';
    if (!VALID_ENDGAME.has(merged.endgame_result)) merged.endgame_result = 'none';

    return merged;
  } catch {
    return normalizeLocally(raw);
  }
}

export async function normalizePitSubmission(raw) {
  try {
    const normalized = normalizePitLocally(raw);
    if (!Array.isArray(normalized.ai_tags)) normalized.ai_tags = [];
    normalized.confidence_score = clamp(Number(normalized.confidence_score || 0.65), 0, 1);
    return normalized;
  } catch {
    return normalizePitLocally(raw);
  }
}
