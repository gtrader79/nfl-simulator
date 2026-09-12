/**
 * NFL Simulator Version 1 analytical configuration.
 *
 * Source: Architecture/proposed-model-config.json
 * Calibration report: MCR-v1-20260903
 * Product-owner approval: 2026-09-04
 * Scenario 6 Injuries analytical approval: 2026-09-12
 * Scenario 6 holdout disposition: certified with qualified exception
 *
 * Fitted numbers must never be edited manually. A future model change requires
 * a new calibrated artifact, calibration report, and explicit approval.
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export const MODEL_CONFIG = deepFreeze({
  "modelVersion": "v1-calibrated-20260903",
  "calibrationReportId": "MCR-v1-20260903",
  "certification": {
    "status": "approved-for-phase-4d-implementation",
    "reportApprovedDate": "2026-09-04",
    "productionExportAuthorized": true,
    "acceptedExceptions": [
      {
        "criterion": "expectedCalibrationError",
        "observed": 0.06144344635955881,
        "threshold": 0.04,
        "disposition": "FAIL — FORMALLY ACCEPTED",
        "approvedDate": "2026-09-03"
      },
      {
        "criterion": "maximumEligibleBinGap",
        "observed": 0.1902691016259433,
        "threshold": 0.08,
        "disposition": "FAIL — FORMALLY ACCEPTED",
        "approvedDate": "2026-09-03"
      }
    ]
  },
  "training": {
    "firstSeason": 2015,
    "lastSeason": 2024,
    "holdoutSeason": 2025,
    "trainingGames": 2457
  },
  "coverageThreshold": 0.85,
  "iterations": 10000,
  "coefficientPrecision": "IEEE-754 double; full JSON serialization precision",
  "selectedRegularization": {
    "alpha": 100.0,
    "halfLife": 4,
    "strongPenaltyMultiplier": 4.0
  },
  "metricPairs": [
    {
      "id": "pass_efficiency",
      "offenseMetric": "offense.pass_epa_per_dropback",
      "defenseMetric": "defense.pass_epa_allowed_per_dropback",
      "coefficient": 0.8243690309952162,
      "active": true,
      "nominalCoverageContribution": 0.24217318812166533
    },
    {
      "id": "rush_efficiency",
      "offenseMetric": "offense.rush_epa_per_attempt",
      "defenseMetric": "defense.rush_epa_allowed_per_attempt",
      "coefficient": 0.7598481249479976,
      "active": true,
      "nominalCoverageContribution": 0.22321901477154582
    },
    {
      "id": "success_rate",
      "offenseMetric": "offense.success_rate",
      "defenseMetric": "defense.success_rate_allowed",
      "coefficient": 0.755480929957955,
      "active": true,
      "nominalCoverageContribution": 0.22193607291647544
    },
    {
      "id": "pressure",
      "offenseMetric": "offense.pressure_allowed_rate",
      "defenseMetric": "defense.pressure_generated_rate",
      "coefficient": 0.3030976202510534,
      "active": true,
      "nominalCoverageContribution": 0.08904036208113376
    },
    {
      "id": "explosiveness",
      "offenseMetric": "offense.explosive_play_rate",
      "defenseMetric": "defense.explosive_play_rate_allowed",
      "coefficient": 0.23519989861033305,
      "active": true,
      "nominalCoverageContribution": 0.06909418858638242
    },
    {
      "id": "interceptions",
      "offenseMetric": "offense.interception_rate",
      "defenseMetric": "defense.interception_forced_rate",
      "coefficient": 0.5260518762536409,
      "active": true,
      "nominalCoverageContribution": 0.1545371735227973
    },
    {
      "id": "fumbles",
      "offenseMetric": "offense.fumble_rate",
      "defenseMetric": "defense.fumble_forced_rate",
      "coefficient": 0.0,
      "active": false,
      "nominalCoverageContribution": 0.0
    }
  ],
  "metricDirections": {
    "offense.pass_epa_per_dropback": {
      "higherIsBetter": true
    },
    "offense.rush_epa_per_attempt": {
      "higherIsBetter": true
    },
    "offense.success_rate": {
      "higherIsBetter": true
    },
    "offense.pressure_allowed_rate": {
      "higherIsBetter": false
    },
    "offense.explosive_play_rate": {
      "higherIsBetter": true
    },
    "offense.interception_rate": {
      "higherIsBetter": false
    },
    "offense.fumble_rate": {
      "higherIsBetter": false
    },
    "defense.pass_epa_allowed_per_dropback": {
      "higherIsBetter": false
    },
    "defense.rush_epa_allowed_per_attempt": {
      "higherIsBetter": false
    },
    "defense.success_rate_allowed": {
      "higherIsBetter": false
    },
    "defense.pressure_generated_rate": {
      "higherIsBetter": true
    },
    "defense.explosive_play_rate_allowed": {
      "higherIsBetter": false
    },
    "defense.interception_forced_rate": {
      "higherIsBetter": true
    },
    "defense.fumble_forced_rate": {
      "higherIsBetter": true
    }
  },
  "featureStatus": {
    "pairFeature.pass_efficiency": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "pairFeature.rush_efficiency": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "pairFeature.success_rate": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "pairFeature.pressure": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "pairFeature.explosiveness": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "pairFeature.interceptions": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "pairFeature.fumbles": {
      "active": false,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "situational.venue": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "situational.windAbove10Pass": {
      "active": false,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "situational.windAbove20Pass": {
      "active": false,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "situational.rainScore": {
      "active": false,
      "fixedZero": false,
      "stronglyRegularized": true
    },
    "situational.snowScore": {
      "active": false,
      "fixedZero": false,
      "stronglyRegularized": true
    },
    "situational.travelEast": {
      "active": false,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "situational.restShort": {
      "active": false,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "situational.restExtended": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "situational.roundWC": {
      "active": false,
      "fixedZero": true,
      "stronglyRegularized": true
    },
    "situational.roundDIV": {
      "active": false,
      "fixedZero": true,
      "stronglyRegularized": true
    },
    "situational.roundCON": {
      "active": false,
      "fixedZero": true,
      "stronglyRegularized": true
    },
    "situational.roundSB": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": true
    },
    "situational.momentum": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    },
    "situational.divisionHome": {
      "active": true,
      "fixedZero": false,
      "stronglyRegularized": false
    }
  },
  "shrinkage": {
    "offense.pass_epa_per_dropback": 400.0,
    "offense.rush_epa_per_attempt": 400.0,
    "offense.success_rate": 400.0,
    "offense.pressure_allowed_rate": 200.0,
    "offense.explosive_play_rate": 800.0,
    "offense.interception_rate": 800.0,
    "offense.fumble_rate": 800.0,
    "defense.pass_epa_allowed_per_dropback": 800.0,
    "defense.rush_epa_allowed_per_attempt": 800.0,
    "defense.success_rate_allowed": 800.0,
    "defense.pressure_generated_rate": 800.0,
    "defense.explosive_play_rate_allowed": 800.0,
    "defense.interception_forced_rate": 800.0,
    "defense.fumble_forced_rate": 800.0
  },
  "probabilityCalibration": {
    "slope": 0.1205288732344612,
    "intercept": 0.0
  },
  "residualDistribution": {
    "probabilities": [
      0.0025,
      0.007475000000000001,
      0.012450000000000001,
      0.017425,
      0.0224,
      0.027375,
      0.032350000000000004,
      0.037325000000000004,
      0.042300000000000004,
      0.047275000000000005,
      0.052250000000000005,
      0.057225000000000005,
      0.062200000000000005,
      0.06717500000000001,
      0.07215,
      0.077125,
      0.0821,
      0.08707500000000001,
      0.09205,
      0.097025,
      0.10200000000000001,
      0.10697500000000001,
      0.11195000000000001,
      0.116925,
      0.12190000000000001,
      0.12687500000000002,
      0.13185000000000002,
      0.136825,
      0.1418,
      0.14677500000000002,
      0.15175,
      0.156725,
      0.1617,
      0.16667500000000002,
      0.17165000000000002,
      0.176625,
      0.1816,
      0.18657500000000002,
      0.19155,
      0.196525,
      0.2015,
      0.20647500000000002,
      0.21145000000000003,
      0.216425,
      0.2214,
      0.22637500000000002,
      0.23135,
      0.236325,
      0.24130000000000001,
      0.24627500000000002,
      0.25125000000000003,
      0.25622500000000004,
      0.26120000000000004,
      0.266175,
      0.27115,
      0.276125,
      0.2811,
      0.286075,
      0.29105000000000003,
      0.29602500000000004,
      0.301,
      0.305975,
      0.31095,
      0.315925,
      0.3209,
      0.325875,
      0.33085000000000003,
      0.33582500000000004,
      0.34080000000000005,
      0.345775,
      0.35075,
      0.355725,
      0.3607,
      0.36567500000000003,
      0.37065000000000003,
      0.37562500000000004,
      0.3806,
      0.385575,
      0.39055,
      0.395525,
      0.4005,
      0.40547500000000003,
      0.41045000000000004,
      0.41542500000000004,
      0.42040000000000005,
      0.425375,
      0.43035,
      0.435325,
      0.4403,
      0.44527500000000003,
      0.45025000000000004,
      0.45522500000000005,
      0.4602,
      0.465175,
      0.47015,
      0.475125,
      0.4801,
      0.48507500000000003,
      0.49005000000000004,
      0.49502500000000005,
      0.5,
      0.504975,
      0.50995,
      0.514925,
      0.5199,
      0.524875,
      0.5298499999999999,
      0.534825,
      0.5398,
      0.544775,
      0.54975,
      0.554725,
      0.5597,
      0.5646749999999999,
      0.56965,
      0.5746249999999999,
      0.5796,
      0.584575,
      0.58955,
      0.594525,
      0.5994999999999999,
      0.604475,
      0.6094499999999999,
      0.614425,
      0.6194,
      0.624375,
      0.62935,
      0.634325,
      0.6393,
      0.6442749999999999,
      0.64925,
      0.654225,
      0.6592,
      0.664175,
      0.66915,
      0.674125,
      0.6791,
      0.684075,
      0.6890499999999999,
      0.694025,
      0.699,
      0.703975,
      0.70895,
      0.713925,
      0.7189,
      0.7238749999999999,
      0.72885,
      0.733825,
      0.7388,
      0.743775,
      0.74875,
      0.753725,
      0.7586999999999999,
      0.763675,
      0.7686499999999999,
      0.773625,
      0.7786,
      0.783575,
      0.78855,
      0.793525,
      0.7985,
      0.8034749999999999,
      0.80845,
      0.813425,
      0.8184,
      0.823375,
      0.82835,
      0.833325,
      0.8383,
      0.843275,
      0.84825,
      0.853225,
      0.8582,
      0.863175,
      0.86815,
      0.873125,
      0.8781,
      0.8830749999999999,
      0.88805,
      0.893025,
      0.898,
      0.902975,
      0.90795,
      0.912925,
      0.9178999999999999,
      0.922875,
      0.92785,
      0.932825,
      0.9378,
      0.942775,
      0.94775,
      0.952725,
      0.9577,
      0.962675,
      0.96765,
      0.972625,
      0.9776,
      0.982575,
      0.98755,
      0.992525,
      0.9975
    ],
    "quantiles": [
      -37.98440261304751,
      -33.694653008303696,
      -30.502967801337146,
      -28.40041999493373,
      -27.202675941315544,
      -25.987578771187525,
      -25.27340261342025,
      -24.48687710388986,
      -23.803910209273692,
      -23.202344859346933,
      -22.512269868375007,
      -21.811732016957368,
      -21.345291319825034,
      -20.636445555466537,
      -19.964403847900886,
      -19.413789817683437,
      -18.966934037218728,
      -18.288557857401116,
      -17.75066597815725,
      -17.295104263624253,
      -16.998051354206495,
      -16.598007359715613,
      -15.980362110942895,
      -15.61341727189741,
      -15.314167573798366,
      -15.05592309121394,
      -14.750675328653783,
      -14.35973860993853,
      -13.969847508721964,
      -13.585336459512519,
      -13.221361957696203,
      -12.890593006739412,
      -12.515066482475897,
      -12.297945385440448,
      -11.989330518062584,
      -11.711446245236683,
      -11.447516030653626,
      -11.228370859998758,
      -10.825832654838623,
      -10.53832513233409,
      -10.378142011344522,
      -10.137670145706512,
      -9.874647664874157,
      -9.6204669037985,
      -9.4059435592046,
      -9.275069154474867,
      -9.10006552501345,
      -8.920594738701118,
      -8.64289998834441,
      -8.31287349265443,
      -8.059288056608265,
      -7.878217848475906,
      -7.730515883424527,
      -7.502408205968859,
      -7.328632708223952,
      -7.157899598727219,
      -7.031567455450944,
      -6.847866415664694,
      -6.667543356535133,
      -6.4500263037511765,
      -6.272240992855008,
      -6.024297642711178,
      -5.871593524544587,
      -5.686644791567751,
      -5.4758786972883176,
      -5.315327123107057,
      -5.171334613918955,
      -4.958014639305713,
      -4.727984198184422,
      -4.649884454672404,
      -4.534546596994322,
      -4.355898789649076,
      -4.171894020377359,
      -4.06261928935171,
      -3.852609789037628,
      -3.701427711223915,
      -3.5454329349006177,
      -3.3577734070769836,
      -3.2071949717120227,
      -3.0757813697577454,
      -2.9129932834191345,
      -2.8017063142538,
      -2.632511018256623,
      -2.445150462095256,
      -2.2387381212345074,
      -2.058171226118341,
      -1.910804303153191,
      -1.7651757416125253,
      -1.6380261628257171,
      -1.5180311886173365,
      -1.351842957184925,
      -1.239612506398117,
      -1.092005076476409,
      -0.9492735209391684,
      -0.8142391239789437,
      -0.7071678269797983,
      -0.5567531855875005,
      -0.39561137069591157,
      -0.2529842307464848,
      -0.1304584954701225,
      0.0,
      0.1304584954701225,
      0.25298423074648657,
      0.39561137069591157,
      0.5567531855875059,
      0.7071678269797983,
      0.8142391239789435,
      0.9492735209391684,
      1.092005076476409,
      1.239612506398117,
      1.351842957184925,
      1.5180311886173385,
      1.6380261628257171,
      1.7651757416125216,
      1.910804303153191,
      2.0581712261183363,
      2.2387381212345074,
      2.44515046209526,
      2.632511018256623,
      2.8017063142538,
      2.9129932834191345,
      3.0757813697577485,
      3.2071949717120227,
      3.3577734070769862,
      3.5454329349006177,
      3.701427711223915,
      3.852609789037628,
      4.062619289351711,
      4.171894020377359,
      4.355898789649074,
      4.534546596994322,
      4.6498844546724,
      4.727984198184422,
      4.958014639305713,
      5.171334613918961,
      5.315327123107057,
      5.4758786972883176,
      5.686644791567751,
      5.871593524544581,
      6.024297642711178,
      6.272240992855004,
      6.450026303751179,
      6.667543356535133,
      6.847866415664694,
      7.031567455450944,
      7.157899598727209,
      7.328632708223951,
      7.502408205968856,
      7.730515883424527,
      7.878217848475905,
      8.059288056608265,
      8.31287349265443,
      8.64289998834441,
      8.92059473870112,
      9.10006552501345,
      9.275069154474867,
      9.4059435592046,
      9.620466903798503,
      9.874647664874157,
      10.137670145706517,
      10.378142011344522,
      10.538325132334087,
      10.825832654838623,
      11.228370859998758,
      11.447516030653635,
      11.711446245236683,
      11.989330518062596,
      12.297945385440448,
      12.515066482475898,
      12.890593006739412,
      13.221361957696203,
      13.585336459512522,
      13.969847508721958,
      14.359738609938532,
      14.750675328653783,
      15.05592309121394,
      15.314167573798366,
      15.613417271897381,
      15.980362110942895,
      16.59800735971561,
      16.998051354206495,
      17.295104263624253,
      17.75066597815725,
      18.288557857401102,
      18.96693403721872,
      19.413789817683433,
      19.964403847900886,
      20.636445555466533,
      21.345291319825037,
      21.811732016957375,
      22.51226986837502,
      23.20234485934694,
      23.8039102092737,
      24.486877103889856,
      25.27340261342026,
      25.987578771187522,
      27.202675941315544,
      28.40041999493373,
      30.502967801337185,
      33.694653008303696,
      37.98440261304763
    ],
    "checksumSha256": "5130eb5efb8e8ea653b82041a2898297c441dd1fc9f20c1b6174a77881f8bc70"
  },
  "situational": {
    "venue": 1.9968955489348619,
    "wind": {
      "above10Pass": 0.0,
      "above20Pass": 0.0
    },
    "precipitation": {
      "rainScore": 0.0,
      "snowScore": 0.0
    },
    "travelEast": 0.0,
    "rest": {
      "short": 0.0,
      "extended": 1.034227195739033
    },
    "gameType": {
      "wildCard": 0.0,
      "divisional": 0.0,
      "conference": 0.0,
      "superBowl": -0.23179401288203139
    },
    "momentum": 1.4571437586150784,
    "divisionHomeInteraction": -0.2646781537209383
  },
  "injuries": {
    "version": "scenario6-injuries-20260912",
    "certification": {
      "status": "certified-with-qualified-holdout-exception",
      "approvedDate": "2026-09-12",
      "holdoutSeason": 2025,
      "holdoutExposed": true,
      "retuningAuthorized": false,
      "acceptedExceptions": [
        {
          "criterion": "simpleBaselineLogLossPairedBootstrapUpper95",
          "observed": 0.012869,
          "threshold": 0.005,
          "disposition": "FAIL — FORMALLY ACCEPTED",
          "approvedDate": "2026-09-12"
        },
        {
          "criterion": "simpleBaselineBrierPairedBootstrapUpper95",
          "observed": 0.005412,
          "threshold": 0.005,
          "disposition": "FAIL — FORMALLY ACCEPTED",
          "approvedDate": "2026-09-12"
        },
        {
          "criterion": "expectedCalibrationError",
          "observed": 0.045268,
          "threshold": 0.04,
          "disposition": "FAIL — FORMALLY ACCEPTED",
          "approvedDate": "2026-09-12"
        },
        {
          "criterion": "maximumEligibleBinGap",
          "observed": 0.152149,
          "threshold": 0.08,
          "disposition": "FAIL — FORMALLY ACCEPTED",
          "approvedDate": "2026-09-12"
        }
      ]
    },
    "development": {
      "featureFirstSeason": 2016,
      "featureLastSeason": 2024,
      "coefficientFirstSeason": 2018,
      "coefficientLastSeason": 2024,
      "rollingValidationFirstSeason": 2021,
      "rollingValidationLastSeason": 2024,
      "manualTranslationGames": 2472,
      "holdoutEligibleGames": 266
    },
    "selectedRegularization": {
      "alpha": 100.0,
      "halfLife": "none"
    },
    "baselineAvailability": 1.0,
    "featureOrientation": "team-b-minus-team-a",
    "availabilityShocks": {
      "available": 0.0,
      "questionable": 0.316669,
      "doubtful": 0.990426,
      "out": 1.0
    },
    "groupBurdenBounds": {
      "minimum": 0.0,
      "maximum": 1.0
    },
    "manualTranslation": {
      "method": "group_lsq_weight",
      "developmentFirstSeason": 2016,
      "developmentLastSeason": 2024
    },
    "positionGroups": [
      {
        "id": "qb",
        "groupImportanceWeight": 0.8095332291842642,
        "coefficient": 4.128588701054724,
        "active": true,
        "fixedZero": false
      },
      {
        "id": "rb",
        "groupImportanceWeight": 0.3383135840625962,
        "coefficient": 2.7755084081758117,
        "active": true,
        "fixedZero": false
      },
      {
        "id": "wr",
        "groupImportanceWeight": 0.24501583338979643,
        "coefficient": 6.217565833083719,
        "active": true,
        "fixedZero": false
      },
      {
        "id": "te",
        "groupImportanceWeight": 0.3670670359302999,
        "coefficient": 1.2334874543453394,
        "active": true,
        "fixedZero": false
      },
      {
        "id": "ol",
        "groupImportanceWeight": 0.19708840389184681,
        "coefficient": 1.3409174883564927,
        "active": true,
        "fixedZero": false
      },
      {
        "id": "defensive-front",
        "groupImportanceWeight": 0.17959775722408947,
        "coefficient": 0.0,
        "active": false,
        "fixedZero": true
      },
      {
        "id": "lb",
        "groupImportanceWeight": 0.20475146692900625,
        "coefficient": 0.0,
        "active": false,
        "fixedZero": true
      },
      {
        "id": "secondary",
        "groupImportanceWeight": 0.17648600880208537,
        "coefficient": 0.0,
        "active": false,
        "fixedZero": true
      }
    ],
    "monitoring": {
      "season": 2026,
      "interimMinimumEligibleBinaryGames": 200,
      "minimumEligibleCalibrationBinGames": 40,
      "expectedCalibrationErrorThreshold": 0.04,
      "maximumEligibleBinGapThreshold": 0.08,
      "pairedBootstrapDegradationMaximum": 0.005,
      "compareAgainstFrozenScenario5": true,
      "compareAgainstSimpleBaseline": true,
      "finalSeasonReviewRequired": true,
      "recalibrationTrigger": "If the prospective Scenario 6 review confirms material calibration or comparative-performance failure, recalibration requires a new untouched holdout; exposed 2025 may enter training only after a later season is designated as the new untouched holdout."
    }
  },
  "sourceData": {
    "provider": "nflreadpy / nflfastR",
    "nflreadpyVersion": "0.1.5",
    "schemaVersion": "1.0.0",
    "firstSeason": 2012,
    "trainingLastSeason": 2024,
    "holdoutSeason": 2025,
    "generationDate": "2026-09-03"
  },
  "monitoring": {
    "season": 2026,
    "interimMinimumEligibleBinaryGames": 200,
    "minimumEligibleCalibrationBinGames": 40,
    "expectedCalibrationErrorThreshold": 0.04,
    "maximumEligibleBinGapThreshold": 0.08,
    "finalSeasonReviewRequired": true,
    "recalibrationTrigger": "If either threshold fails, Version 1.1 recalibration is mandatory; 2025 may enter training only when 2026 becomes the new untouched holdout."
  }
});

export default MODEL_CONFIG;

