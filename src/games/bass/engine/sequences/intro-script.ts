/**
 * Liste de commandes de l'introduction du CD de *Beneath a Steel Sky* (la narration du feu de camp jusqu'à l'arrivée à Union City).
 *
 * Référence : ScummVM engines/sky/intro.cpp (`Intro::_mainIntroSeq`, `Intro::_cdIntroSeq`, définitions `CD_*` / `CDV_*` et codes de
 * commande), GPL v3 ou ultérieure. Les deux tableaux sont recopiés commande par commande (les commentaires donnent le nom du fichier dans
 * ScummVM ; les répliques ne sont pas reproduites) ; les identifiants sont ceux de `sky.dnr`. L'introduction des disquettes
 * (`_floppyIntroSeq`, `SCROLLFLIRT`, `COMMANDFLIRT`) n'est pas portée (`docs/bass/plan.md` D8).
 *
 * Une commande est un tuple : le code (`Op`, mêmes valeurs que ScummVM) puis ses paramètres. `ShowScreen` : fichier, plein écran ;
 * `Delay` : millisecondes ; les autres : un identifiant de fichier ou un numéro de morceau.
 */

/** Codes de commande de `intro.cpp` (`SHOWSCREEN`…`CLEARBOTTOM`). */
export const Op = {
  ShowScreen: 0,
  FadeUp: 1,
  FadeDown: 2,
  Delay: 3,
  DoFlirt: 4,
  BgFlirt: 7,
  WaitFlirt: 8,
  StopFlirt: 9,
  StartMusic: 10,
  PlayVoice: 12,
  WaitVoice: 13,
  LoadBg: 14,
  PlayBg: 15,
  LoopBg: 16,
  StopBg: 17,
  ClearBottom: 18,
} as const;

export type IntroCommand =
  | readonly [typeof Op.ShowScreen, file: number, fullscreen: boolean]
  | readonly [
      (
        | typeof Op.FadeUp
        | typeof Op.Delay
        | typeof Op.DoFlirt
        | typeof Op.BgFlirt
        | typeof Op.StartMusic
        | typeof Op.PlayVoice
        | typeof Op.LoadBg
      ),
      arg: number,
    ]
  | readonly [typeof Op.FadeDown | typeof Op.WaitFlirt | typeof Op.StopFlirt | typeof Op.WaitVoice | typeof Op.PlayBg | typeof Op.LoopBg | typeof Op.StopBg | typeof Op.ClearBottom];

/** `_mainIntroSeq` : écrans de Revolution (joués aussi avec le CD, avant la narration). */
export const MAIN_INTRO: readonly IntroCommand[] = [
  [Op.Delay, 3000],
  [Op.FadeDown],
  [Op.ShowScreen, 60112, false],
  [Op.FadeUp, 60113],
  [Op.Delay, 8000],
  [Op.FadeDown],
  [Op.ShowScreen, 60114, false],
  [Op.FadeUp, 60115],
  [Op.Delay, 2000],
  [Op.FadeDown],
];

/** `_cdIntroSeq` : narration du CD. */
export const CD_INTRO: readonly IntroCommand[] = [
  [Op.PlayVoice, 59500], // CDV_00
  [Op.LoadBg, 59499],
  [Op.LoopBg],
  [Op.WaitVoice],
  [Op.PlayVoice, 59504], // CDV_01
  [Op.ShowScreen, 59502, false], // CD_1_LOG
  [Op.FadeUp, 59501], // CD_PAL
  [Op.BgFlirt, 59503], // CD_1
  [Op.WaitVoice],
  [Op.PlayVoice, 59505], // CDV_02
  [Op.WaitVoice],
  [Op.StopFlirt],
  [Op.BgFlirt, 59506], // CD_2
  [Op.PlayVoice, 59507], // CDV_03
  [Op.WaitVoice],
  [Op.PlayVoice, 59508], // CDV_04
  [Op.WaitFlirt],
  [Op.WaitVoice],
  [Op.PlayVoice, 59510], // CDV_05
  [Op.Delay, 2000],
  [Op.BgFlirt, 59509], // CD_3
  [Op.WaitVoice],
  [Op.PlayVoice, 59511], // CDV_06
  [Op.WaitFlirt],
  [Op.WaitVoice],
  [Op.PlayVoice, 59513], // CDV_07
  [Op.BgFlirt, 59512], // CD_5
  [Op.WaitVoice],
  [Op.PlayVoice, 59514], // CDV_08
  [Op.WaitVoice],
  [Op.PlayVoice, 59515], // CDV_09
  [Op.WaitFlirt],
  [Op.WaitVoice],
  [Op.PlayVoice, 59518], // CDV_10
  [Op.BgFlirt, 59516], // CD_7
  [Op.WaitVoice],
  [Op.PlayVoice, 59520], // CDV_11
  [Op.WaitFlirt],
  [Op.FadeDown],
  [Op.ShowScreen, 59522, false], // CD_11_LOG
  [Op.FadeUp, 59521], // CD_11_PAL
  [Op.WaitVoice],
  [Op.PlayVoice, 59523], // CDV_12
  [Op.Delay, 1600],
  [Op.BgFlirt, 59519], // CD_11
  [Op.WaitVoice],
  [Op.PlayVoice, 59525], // CDV_13
  [Op.WaitVoice],
  [Op.WaitFlirt],
  [Op.WaitVoice],
  [Op.PlayVoice, 59527], // CDV_14
  [Op.LoadBg, 59498],
  [Op.PlayBg],
  [Op.DoFlirt, 59524], // CD_13
  [Op.WaitVoice],
  [Op.PlayVoice, 59528], // CDV_15
  [Op.FadeDown],
  [Op.ShowScreen, 59530, false], // CD_15_LOG
  [Op.FadeUp, 59529], // CD_15_PAL
  [Op.WaitVoice],
  [Op.LoadBg, 59496],
  [Op.LoopBg],
  [Op.PlayVoice, 59531], // CDV_16
  [Op.WaitVoice],
  [Op.PlayVoice, 59534], // CDV_17
  [Op.Delay, 2000],
  [Op.ShowScreen, 59532, false], // CD_17_LOG
  [Op.WaitVoice],
  [Op.BgFlirt, 59533], // CD_17
  [Op.PlayVoice, 59535], // CDV_18
  [Op.LoadBg, 59497],
  [Op.LoopBg],
  [Op.WaitFlirt],
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.ShowScreen, 59538, true], // CD_19_LOG
  [Op.FadeUp, 59537], // CD_19_PAL
  [Op.PlayVoice, 59536], // CDV_19
  [Op.WaitVoice],
  [Op.PlayVoice, 59539], // CDV_20
  [Op.FadeDown],
  [Op.ShowScreen, 59540, true], // CD_20_LOG
  [Op.FadeUp, 59537], // CD_19_PAL
  [Op.WaitVoice],
  [Op.LoadBg, 59496],
  [Op.LoopBg],
  [Op.PlayVoice, 59541], // CDV_21
  [Op.FadeDown],
  [Op.ShowScreen, 59542, true], // CD_21_LOG
  [Op.FadeUp, 59537], // CD_19_PAL
  [Op.WaitVoice],
  [Op.PlayVoice, 59545], // CDV_22
  [Op.LoadBg, 59494],
  [Op.PlayBg],
  [Op.WaitVoice],
  [Op.PlayVoice, 59546], // CDV_23
  [Op.FadeDown],
  [Op.WaitVoice],
  [Op.ShowScreen, 59550, true], // CD_24_LOG
  [Op.FadeUp, 59547], // CD_23_PAL
  [Op.PlayVoice, 59551], // CDV_24
  [Op.WaitVoice],
  [Op.PlayVoice, 59554], // CDV_25
  [Op.WaitVoice],
  [Op.PlayVoice, 59556], // CDV_26
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.ShowScreen, 59560, true], // CD_27_LOG
  [Op.FadeUp, 59559], // CD_27_PAL
  [Op.PlayVoice, 59558], // CDV_27
  [Op.WaitVoice],
  [Op.PlayVoice, 59562], // CDV_29
  [Op.WaitVoice],
  [Op.PlayVoice, 59563], // CDV_30
  [Op.WaitVoice],
  [Op.BgFlirt, 59557], // CD_27
  [Op.PlayVoice, 59565], // CDV_31
  [Op.WaitFlirt],
  [Op.ClearBottom],
  [Op.WaitVoice],
  [Op.PlayVoice, 59566], // CDV_32
  [Op.WaitVoice],
  [Op.PlayVoice, 59567], // CDV_33
  [Op.WaitVoice],
  [Op.PlayVoice, 59568], // CDV_34
  [Op.WaitVoice],
  [Op.PlayVoice, 59570], // CDV_35
  [Op.WaitVoice],
  [Op.PlayVoice, 59574], // CDV_36
  [Op.FadeDown],
  [Op.ShowScreen, 59572, true], // CD_35_LOG
  [Op.FadeUp, 59571], // CD_35_PAL
  [Op.WaitVoice],
  [Op.PlayVoice, 59576], // CDV_37
  [Op.DoFlirt, 59569], // CD_35
  [Op.ClearBottom],
  [Op.WaitVoice],
  [Op.PlayVoice, 59579], // CDV_38
  [Op.DoFlirt, 59575], // CD_37
  [Op.WaitVoice],
  [Op.PlayVoice, 59581], // CDV_39
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.ShowScreen, 59585, true], // CD_40_LOG
  [Op.FadeUp, 59584], // CD_40_PAL
  [Op.PlayVoice, 59583], // CDV_40
  [Op.WaitVoice],
  [Op.PlayVoice, 59587], // CDV_41
  [Op.WaitVoice],
  [Op.PlayVoice, 59588], // CDV_42
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.ShowScreen, 59592, true], // CD_43_LOG
  [Op.FadeUp, 59591], // CD_43_PAL
  [Op.PlayVoice, 59590], // CDV_43
  [Op.WaitVoice],
  [Op.DoFlirt, 59589], // CD_43
  [Op.PlayVoice, 59596], // CDV_45
  [Op.FadeDown],
  [Op.ShowScreen, 59598, false], // CD_45_LOG
  [Op.FadeUp, 59597], // CD_45_PAL
  [Op.WaitVoice],
  [Op.PlayVoice, 59600], // CDV_46
  [Op.DoFlirt, 59595], // CD_45
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.ShowScreen, 59604, true], // CD_47_LOG
  [Op.FadeUp, 59603], // CD_47_PAL
  [Op.PlayVoice, 59602], // CDV_47
  [Op.WaitVoice],
  [Op.PlayVoice, 59606], // CDV_48
  [Op.FadeDown],
  [Op.ShowScreen, 59608, true], // CD_48_LOG
  [Op.FadeUp, 59607], // CD_48_PAL
  [Op.WaitVoice],
  [Op.BgFlirt, 59605], // CD_48
  [Op.PlayVoice, 59610], // CDV_49
  [Op.WaitVoice],
  [Op.PlayVoice, 59612], // CDV_50
  [Op.WaitFlirt],
  [Op.WaitVoice],
  [Op.PlayVoice, 59613], // CDV_51
  [Op.BgFlirt, 59609], // CD_49
  [Op.WaitVoice],
  [Op.PlayVoice, 59614], // CDV_52
  [Op.WaitVoice],
  [Op.PlayVoice, 59615], // CDV_53
  [Op.WaitVoice],
  [Op.WaitFlirt],
  [Op.PlayVoice, 59616], // CDV_54
  [Op.DoFlirt, 59611], // CD_50
  [Op.WaitVoice],
  [Op.PlayVoice, 59618], // CDV_55
  [Op.WaitVoice],
  [Op.PlayVoice, 59621], // CDV_56
  [Op.FadeDown],
  [Op.ShowScreen, 59620, false], // CD_55_LOG
  [Op.FadeUp, 59619], // CD_55_PAL
  [Op.WaitVoice],
  [Op.PlayVoice, 59622], // CDV_57
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.ShowScreen, 59626, false], // CD_58_LOG
  [Op.FadeUp, 59625], // CD_58_PAL
  [Op.PlayVoice, 59624], // CDV_58
  [Op.WaitVoice],
  [Op.PlayVoice, 59627], // CDV_59
  [Op.WaitVoice],
  [Op.PlayVoice, 59628], // CDV_60
  [Op.WaitVoice],
  [Op.PlayVoice, 59629], // CDV_61
  [Op.WaitVoice],
  [Op.PlayVoice, 59630], // CDV_62
  [Op.BgFlirt, 59623], // CD_58
  [Op.WaitVoice],
  [Op.PlayVoice, 59631], // CDV_63
  [Op.WaitVoice],
  [Op.PlayVoice, 59632], // CDV_64
  [Op.WaitFlirt],
  [Op.WaitVoice],
  [Op.PlayVoice, 59633], // CDV_65
  [Op.FadeDown],
  [Op.WaitVoice],
  [Op.ShowScreen, 59637, false], // CD_66_LOG
  [Op.FadeUp, 59636], // CD_66_PAL
  [Op.PlayVoice, 59635], // CDV_66
  [Op.WaitVoice],
  [Op.PlayVoice, 59639], // CDV_67
  [Op.FadeDown],
  [Op.ShowScreen, 59641, false], // CD_67_LOG
  [Op.FadeUp, 59640], // CD_67_PAL
  [Op.WaitVoice],
  [Op.PlayVoice, 59642], // CDV_68
  [Op.WaitVoice],
  [Op.PlayVoice, 59644], // CDV_69
  [Op.FadeDown],
  [Op.ShowScreen, 59646, false], // CD_69_LOG
  [Op.FadeUp, 59645], // CD_69_PAL
  [Op.WaitVoice],
  [Op.PlayVoice, 59647], // CDV_70
  [Op.DoFlirt, 59643], // CD_69
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.PlayVoice, 59648], // CDV_71
  [Op.WaitVoice],
  [Op.ShowScreen, 59651, true], // CD_72_LOG
  [Op.FadeUp, 59650], // CD_72_PAL
  [Op.PlayVoice, 59649], // CDV_72
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.ShowScreen, 59653, true], // CD_73_LOG
  [Op.FadeUp, 59652], // CD_73_PAL
  [Op.PlayVoice, 59654], // CDV_73
  [Op.WaitVoice],
  [Op.PlayVoice, 59655], // CDV_74
  [Op.WaitVoice],
  [Op.PlayVoice, 59656], // CDV_75
  [Op.FadeDown],
  [Op.ShowScreen, 59658, true], // CD_76_LOG
  [Op.FadeUp, 59657], // CD_76_PAL
  [Op.WaitVoice],
  [Op.PlayVoice, 59659], // CDV_76
  [Op.WaitVoice],
  [Op.PlayVoice, 59660], // CDV_77
  [Op.WaitVoice],
  [Op.FadeDown],
  [Op.ClearBottom],
  [Op.ShowScreen, 59662, false], // CD_78_LOG
  [Op.FadeUp, 59661], // CD_78_PAL
  [Op.PlayVoice, 59663], // CDV_78
  [Op.WaitVoice],
  [Op.PlayVoice, 59664], // CDV_79
  [Op.WaitVoice],
  [Op.PlayVoice, 59665], // CDV_80
  [Op.BgFlirt, 60087], // CD_100
  [Op.WaitVoice],
  [Op.PlayVoice, 59666], // CDV_81
  [Op.WaitVoice],
  [Op.PlayVoice, 59667], // CDV_82
  [Op.WaitVoice],
  [Op.WaitFlirt],
  [Op.ShowScreen, 60088, false], // CD_101_LOG
  [Op.BgFlirt, 60099], // CD_101
  [Op.PlayVoice, 59668], // CDV_83
  [Op.WaitVoice],
  [Op.PlayVoice, 59669], // CDV_84
  [Op.WaitVoice],
  [Op.PlayVoice, 59670], // CDV_85
  [Op.WaitVoice],
  [Op.WaitFlirt],
  [Op.ClearBottom],
  [Op.ShowScreen, 60090, false], // CD_102_LOG
  [Op.PlayVoice, 59671], // CDV_86
  [Op.DoFlirt, 60091], // CD_102
  [Op.FadeDown],
  [Op.ShowScreen, 60093, false], // CD_103_LOG
  [Op.FadeUp, 60092], // CD_103_PAL
  [Op.BgFlirt, 60094], // CD_103
  [Op.WaitVoice],
  [Op.PlayVoice, 59672], // CDV_87
  [Op.WaitFlirt],
  [Op.WaitVoice],
  [Op.StartMusic, 2],
  [Op.FadeDown],
  [Op.ShowScreen, 60096, true], // CD_104_LOG
  [Op.FadeUp, 60095], // CD_104_PAL
  [Op.DoFlirt, 60097], // CD_104
  [Op.DoFlirt, 60098], // CD_105
];
