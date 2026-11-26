/**
 * 知識群島：Cloudflare Worker 後端
 *
 * 網頁（public/）由 Cloudflare 直接提供；/api/<名稱> 由這支程式處理。
 * 計分、金幣、買東西、換點都在這裡計算，學生無法從瀏覽器竄改。
 *
 * 呼叫方式：POST /api/<名稱>，內容為 JSON：{ "args": [...] }
 * 回覆：{ "ok": 結果 } 或 { "err": "錯誤訊息" }
 */

const SUBJECTS = ['國語', '數學', '自然', '社會', '英文'];
const COMMON = '通用';
const MAX_FAILS = 5;          // 密碼連續錯幾次就暫時鎖住
const LOCK_MS = 10 * 60e3;    // 鎖住 10 分鐘
const TEACHER_MAX_FAILS = 10; // 老師密碼：同一個網路位址錯 10 次才鎖，而且只鎖那個位址

/** 金幣商店：幫船長波波換裝。價格只在這裡設定 */
const SHOP = {
  hat_sailor: { slot: 'hat', name: '水手帽', price: 0 },
  hat_none: { slot: 'hat', name: '不戴帽子', price: 0 },
  hat_flower: { slot: 'hat', name: '小花髮夾', price: 20 },
  hat_bow: { slot: 'hat', name: '蝴蝶結', price: 25 },
  hat_straw: { slot: 'hat', name: '草帽', price: 30 },
  hat_pirate: { slot: 'hat', name: '海盜帽', price: 60 },
  hat_crown: { slot: 'hat', name: '小皇冠', price: 80 },
  hat_wizard: { slot: 'hat', name: '魔法帽', price: 100 },
  acc_none: { slot: 'acc', name: '不戴配件', price: 0 },
  acc_bowtie: { slot: 'acc', name: '領結', price: 30 },
  acc_scarf: { slot: 'acc', name: '圍巾', price: 35 },
  acc_glasses: { slot: 'acc', name: '圓眼鏡', price: 40 },
  acc_medal: { slot: 'acc', name: '金牌', price: 120 },
  color_blue: { slot: 'color', name: '海豹藍', price: 0 },
  color_pink: { slot: 'color', name: '草莓粉', price: 50 },
  color_mint: { slot: 'color', name: '薄荷綠', price: 50 },
  color_cocoa: { slot: 'color', name: '奶茶色', price: 50 },
  color_lav: { slot: 'color', name: '薰衣草', price: 50 },
  color_gold: { slot: 'color', name: '閃亮金', price: 150 },
  // 星星特別款：累積的星星達到門檻才能買（星星不會被花掉）
  hat_stars: { slot: 'hat', name: '星星髮箍', price: 40, stars: 20 },
  acc_wand: { slot: 'acc', name: '星星魔杖', price: 80, stars: 60 },
  color_night: { slot: 'color', name: '星夜藍', price: 120, stars: 120 },
  hat_party: { slot: 'hat', name: '生日帽', price: 40 },
  hat_chef: { slot: 'hat', name: '廚師帽', price: 50 },
  hat_grad: { slot: 'hat', name: '學士帽', price: 90 },
  hat_fedora: { slot: 'hat', name: '白色紳士帽', price: 70 },
  hat_fedora_black: { slot: 'hat', name: '黑色紳士帽', price: 70 },
  hat_tophat: { slot: 'hat', name: '高禮帽', price: 90 },
  acc_lei: { slot: 'acc', name: '花圈', price: 45 },
  acc_headphones: { slot: 'acc', name: '耳機', price: 60 },
  acc_scope: { slot: 'acc', name: '望遠鏡', price: 50 },
  acc_backpack: { slot: 'acc', name: '探險背包', price: 60 },
  hat_starcrown: { slot: 'hat', name: '星星皇冠', price: 100, stars: 60 },
  hat_dino: { slot: 'hat', name: '恐龍帽', price: 70 },
  // 徽章限定款：拿到指定的徽章就能用金幣買
  hat_detective: { slot: 'hat', name: '偵探帽', price: 80, need: 'detective1' },
  acc_ring: { slot: 'acc', name: '救生圈', price: 100, need: 'rescue100' },
  acc_wheel: { slot: 'acc', name: '金色船舵', price: 120, need: 'streak30' },
  acc_flag: { slot: 'acc', name: '五島旗', price: 120, need: 'allfive' },
  color_coral: { slot: 'color', name: '珊瑚橘', price: 50 },
  color_cloud: { slot: 'color', name: '雲朵灰', price: 50 },
  // 角色：換成其他動物（顏色跟著「顏色」走）
  sp_seal: { slot: 'species', name: '小海豹', price: 0 },
  sp_cat: { slot: 'species', name: '小貓', price: 60 },
  sp_bunny: { slot: 'species', name: '小兔', price: 60 },
  sp_bear: { slot: 'species', name: '小熊', price: 60 },
  sp_fox: { slot: 'species', name: '小狐狸', price: 80 },
  sp_sheep: { slot: 'species', name: '小綿羊', price: 80 },
  sp_dog: { slot: 'species', name: '小狗', price: 60 },
  sp_pig: { slot: 'species', name: '小豬', price: 60 },
  sp_mouse: { slot: 'species', name: '小老鼠', price: 60 },
  sp_frog: { slot: 'species', name: '小青蛙', price: 70 },
  sp_tiger: { slot: 'species', name: '小老虎', price: 80 },
  sp_panda: { slot: 'species', name: '貓熊', price: 80 },
  sp_dino: { slot: 'species', name: '小恐龍', price: 100 },
  sp_unicorn: { slot: 'species', name: '獨角獸', price: 120, stars: 100 },
  sp_shiba: { slot: 'species', name: '柴犬', price: 70, stars: 20 },
  sp_husky: { slot: 'species', name: '哈士奇', price: 70, stars: 20 },
  sp_dalmatian: { slot: 'species', name: '大麥町', price: 80, stars: 40 },
  sp_corgi: { slot: 'species', name: '柯基', price: 80, stars: 40 },
  sp_poodle: { slot: 'species', name: '貴賓狗', price: 80, stars: 40 },
  sp_chihuahua: { slot: 'species', name: '吉娃娃', price: 70, stars: 20 },
  sp_schnauzer: { slot: 'species', name: '雪納瑞', price: 80, stars: 40 },
  sp_calico: { slot: 'species', name: '三花貓', price: 80, stars: 40 },
  sp_tabby: { slot: 'species', name: '虎斑貓', price: 70, stars: 20 },
  sp_siamese: { slot: 'species', name: '暹羅貓', price: 80, stars: 40 },
  sp_scottish: { slot: 'species', name: '折耳貓', price: 80, stars: 40 },
  sp_persian: { slot: 'species', name: '波斯貓', price: 90, stars: 60 },
  bottom_none: { slot: 'bottom', name: '不穿', price: 0 },
  bottom_jeans: { slot: 'bottom', name: '牛仔短褲', price: 40 },
  bottom_sport: { slot: 'bottom', name: '運動短褲', price: 40, set: 'set_sport' },
  bottom_pleat: { slot: 'bottom', name: '百褶裙', price: 40 },
  bottom_flower: { slot: 'bottom', name: '碎花裙', price: 50 },
  bottom_tutu: { slot: 'bottom', name: '蓬蓬裙', price: 50 },
  bottom_plaid: { slot: 'bottom', name: '格子裙', price: 60 },
  bottom_suspender: { slot: 'bottom', name: '吊帶褲', price: 60 },
  bottom_grass: { slot: 'bottom', name: '草裙', price: 60 },
  bottom_rainbow: { slot: 'bottom', name: '彩虹裙', price: 80, stars: 40 },
  pet_none: { slot: 'pet', name: '不帶寵物', price: 0 },
  pet_chick: { slot: 'pet', name: '小雞', price: 40, stars: 10 },
  pet_hamster: { slot: 'pet', name: '倉鼠', price: 60, stars: 20 },
  pet_turtle: { slot: 'pet', name: '小烏龜', price: 60, stars: 20 },
  pet_fish: { slot: 'pet', name: '金魚缸', price: 60, stars: 20 },
  pet_bunny: { slot: 'pet', name: '小白兔', price: 80, stars: 40 },
  pet_kitten: { slot: 'pet', name: '小貓咪', price: 80, stars: 40 },
  pet_puppy: { slot: 'pet', name: '小狗狗', price: 80, stars: 40 },
  pet_owl: { slot: 'pet', name: '貓頭鷹', price: 100, stars: 60 },
  pet_dragon: { slot: 'pet', name: '小飛龍', price: 150, stars: 80 },
  pet_sprite: { slot: 'pet', name: '星星精靈', price: 150, stars: 150 },
  pet_gull: { slot: 'pet', name: '小海鷗', price: 60, stars: 20 },
  pet_crab: { slot: 'pet', name: '寄居蟹', price: 60, stars: 20 },
  pet_octo: { slot: 'pet', name: '小章魚', price: 80, stars: 40 },
  pet_lantern: { slot: 'pet', name: '小燈籠魚', price: 100, stars: 60 },
  /* 高級款：要星星＋徽章（徽章數，老師頒發的也算）才能買 */
  hat_royal: { slot: 'hat', name: '寶石皇冠', price: 300, stars: 150, badges: 15, need: 'master20' },
  coat_royal: { slot: 'coat', name: '國王披風', price: 300, stars: 120, badges: 12, need: 'master10' },
  glove_gold: { slot: 'glove', name: '黃金手套', price: 200, stars: 100, badges: 10, need: 'rescue50' },
  bottom_gown: { slot: 'bottom', name: '公主禮服裙', price: 250, stars: 120, badges: 12, need: 'week5' },
  eye_galaxy: { slot: 'eye', name: '銀河眼', price: 200, stars: 100, badges: 10, need: 'reader10' },
  sp_dragon: { slot: 'species', name: '小龍', price: 400, stars: 250, badges: 18, need: 'streak30' },
  pet_whale: { slot: 'pet', name: '雲朵小鯨魚', price: 300, stars: 200, badges: 15, need: 'streak14' },
  pet_phoenix: { slot: 'pet', name: '小鳳凰', price: 400, stars: 300, badges: 20, need: 'comeback' },
  /* 套裝的單品：可以單買（不用徽章）；key 是套裝的關鍵物品，要星星＋徽章 */
  hat_astro: { slot: 'hat', name: '太空頭盔', price: 150, stars: 80, badges: 8, need: 'allfive', set: 'set_space', key: true },
  coat_space: { slot: 'coat', name: '太空衣', price: 60, set: 'set_space' },
  glove_space: { slot: 'glove', name: '太空手套', price: 40, set: 'set_space' },
  pet_robot: { slot: 'pet', name: '小機器人', price: 80, stars: 20, set: 'set_space' },
  hat_captain: { slot: 'hat', name: '船長帽', price: 120, stars: 60, badges: 6, need: 'streak7', set: 'set_pirate', key: true },
  coat_pirate: { slot: 'coat', name: '船長外套', price: 60, set: 'set_pirate' },
  bottom_pirate: { slot: 'bottom', name: '條紋水手褲', price: 40, set: 'set_pirate' },
  pet_parrot: { slot: 'pet', name: '鸚鵡', price: 80, stars: 20, set: 'set_pirate' },
  coat_robe: { slot: 'coat', name: '星空魔法袍', price: 150, stars: 100, badges: 10, need: 'concept', set: 'set_magic', key: true },
  hat_witch: { slot: 'hat', name: '魔法學院尖帽', price: 60, set: 'set_magic' },
  glove_magic: { slot: 'glove', name: '魔法手套', price: 40, set: 'set_magic' },
  pet_blackcat: { slot: 'pet', name: '黑貓使魔', price: 80, stars: 20, set: 'set_magic' },
  acc_trophy: { slot: 'acc', name: '冠軍獎盃', price: 120, stars: 50, badges: 5, need: 'perfect', set: 'set_sport', key: true },
  hat_cap: { slot: 'hat', name: '棒球帽', price: 40, set: 'set_sport' },
  coat_jersey: { slot: 'coat', name: '球衣', price: 50, set: 'set_sport' },
  eye_dark: { slot: 'eye', name: '深紫黑', price: 0 },
  eye_brown: { slot: 'eye', name: '咖啡色', price: 4 },
  eye_blue: { slot: 'eye', name: '藍色', price: 4 },
  eye_green: { slot: 'eye', name: '綠色', price: 4 },
  eye_gray: { slot: 'eye', name: '灰色', price: 4 },
  eye_purple: { slot: 'eye', name: '紫色', price: 20 },
  eye_pink: { slot: 'eye', name: '粉紅色', price: 20 },
  eye_gold: { slot: 'eye', name: '金色', price: 25 },
  eye_sparkle: { slot: 'eye', name: '閃亮眼', price: 30 },
  eye_odd: { slot: 'eye', name: '異色瞳（藍＋金）', price: 40 },
  eye_star: { slot: 'eye', name: '星星眼', price: 60, stars: 30 },
  // 外套
  coat_none: { slot: 'coat', name: '不穿外套', price: 0 },
  coat_rain: { slot: 'coat', name: '黃色雨衣', price: 40 },
  coat_denim: { slot: 'coat', name: '牛仔外套', price: 50 },
  coat_down: { slot: 'coat', name: '羽絨外套', price: 60 },
  coat_team: { slot: 'coat', name: '校隊外套', price: 70 },
  coat_cape: { slot: 'coat', name: '星空斗篷', price: 90, stars: 80 },
  coat_rainbow: { slot: 'coat', name: '彩虹披風', price: 250 },  // 高價長期目標：只要金幣
  // 手套
  glove_none: { slot: 'glove', name: '不戴手套', price: 0 },
  glove_white: { slot: 'glove', name: '白手套', price: 20 },
  glove_red: { slot: 'glove', name: '毛線手套', price: 25 },
  glove_boxing: { slot: 'glove', name: '拳擊手套', price: 50 },
  glove_star: { slot: 'glove', name: '星星手套', price: 60, stars: 40 },
  // 腮紅：基礎色每個 4 金幣
  cheek_pink: { slot: 'cheek', name: '粉紅腮紅', price: 0 },
  cheek_rose: { slot: 'cheek', name: '桃紅腮紅', price: 4 },
  cheek_peach: { slot: 'cheek', name: '蜜桃橘腮紅', price: 4 },
  cheek_lilac: { slot: 'cheek', name: '淡紫腮紅', price: 4 },
  cheek_sky: { slot: 'cheek', name: '天空藍腮紅', price: 4 },
  cheek_shy: { slot: 'cheek', name: '害羞大腮紅', price: 20 },
  cheek_heart: { slot: 'cheek', name: '愛心腮紅', price: 30 },
  cheek_star: { slot: 'cheek', name: '星星腮紅', price: 40 },
  cheek_rainbow: { slot: 'cheek', name: '彩虹腮紅', price: 60 },
  // 背景：畫在波波後面
  bg_none: { slot: 'bg', name: '不用背景', price: 0 },
  bg_beach: { slot: 'bg', name: '晴天海灘', price: 40 },
  bg_reef: { slot: 'bg', name: '珊瑚礁', price: 60 },
  bg_stars: { slot: 'bg', name: '星空', price: 60 },
  bg_lighthouse: { slot: 'bg', name: '燈塔夜景', price: 80 },
  /* ---- 新品（上架日見 DROPS） ---- */
  pet_plushbunny: { slot: 'pet', name: '紅絨毛長耳兔', price: 80, stars: 40 },
  ear_same: { slot: 'ear', name: '跟身體同色', price: 0 },
  ear_red: { slot: 'ear', name: '草莓紅耳朵', price: 30 },
  ear_yellow: { slot: 'ear', name: '奶油黃耳朵', price: 30 },
  ear_mint: { slot: 'ear', name: '薄荷綠耳朵', price: 30 },
  ear_sky: { slot: 'ear', name: '天空藍耳朵', price: 30 },
  ear_lav: { slot: 'ear', name: '薰衣草耳朵', price: 30 },
  ear_rainbow: { slot: 'ear', name: '彩虹耳朵', price: 80, stars: 40 },
  doll_none: { slot: 'doll', name: '不穿娃娃裝', price: 0 },
  pet_popcorn: { slot: 'pet', name: '爆米花娃娃', price: 100, stars: 60 },
  doll_popcorn: { slot: 'doll', name: '爆米花桶裝', price: 150 },
  doll_cupcake: { slot: 'doll', name: '杯子蛋糕裝', price: 120 },
  doll_strawberry: { slot: 'doll', name: '草莓裝', price: 120 },
  doll_carrot: { slot: 'doll', name: '紅蘿蔔裝', price: 120 },
  doll_milk: { slot: 'doll', name: '牛奶盒裝', price: 120 },
  doll_melon: { slot: 'doll', name: '西瓜裝', price: 150 },
  // 畢業袍：學士、碩士、博士用垂布顏色和袖子分出差別
  doll_bachelor: { slot: 'doll', name: '學士服', price: 120 },
  doll_master: { slot: 'doll', name: '碩士服', price: 160 },
  doll_doctor: { slot: 'doll', name: '博士服', price: 200 },
  /* 完整角色（不是海豹的身體）：隱藏商品，固定價格，上架前只顯示陰影 */
  sp_full_cat: { slot: 'species', name: '喵大副', price: 1000, stars: 150, badges: 20, need: 'master20', fixed: true, hidden: true },
  sp_full_dog: { slot: 'species', name: '汪舵手', price: 1200, stars: 180, badges: 22, need: 'streak30', fixed: true, hidden: true },
  sp_full_bunny: { slot: 'species', name: '跳跳兔', price: 1500, stars: 220, badges: 25, need: 'rescue100', fixed: true, hidden: true },
  sp_full_bear: { slot: 'species', name: '熊船長', price: 2000, stars: 250, badges: 28, need: 'reader60', fixed: true, hidden: true },
  /* 自訂顏色：買一次之後可以一直換 */
  color_custom: { slot: 'color', name: '自訂顏色', price: 100, stars: 30 },
  /* 衣服貼圖 */
  sticker_none: { slot: 'sticker', name: '不貼', price: 0 },
  sticker_heart: { slot: 'sticker', name: '愛心貼紙', price: 20 },
  sticker_star: { slot: 'sticker', name: '星星貼紙', price: 20 },
  sticker_bolt: { slot: 'sticker', name: '閃電貼紙', price: 20 },
  sticker_rainbow: { slot: 'sticker', name: '彩虹貼紙', price: 20 },
  sticker_moon: { slot: 'sticker', name: '月亮貼紙', price: 20 },
  sticker_sun: { slot: 'sticker', name: '太陽貼紙', price: 20 },
  sticker_flower: { slot: 'sticker', name: '小花貼紙', price: 20 },
  sticker_note: { slot: 'sticker', name: '音符貼紙', price: 20 },
  sticker_crown: { slot: 'sticker', name: '皇冠貼紙', price: 20 },
  sticker_anchor: { slot: 'sticker', name: '船錨貼紙', price: 20 },
  sticker_clover: { slot: 'sticker', name: '幸運草貼紙', price: 20 },
  sticker_smile: { slot: 'sticker', name: '笑臉貼紙', price: 20 },
  /* 自己畫的旗子：flag_mine 要有通過審核的旗子才能用 */
  flag_none: { slot: 'flag', name: '不插旗子', price: 0 },
  flag_mine: { slot: 'flag', name: '我的旗子', price: 0, mine: true }
};
/* 套裝：要先達到關鍵物品的星星＋徽章才能整套買；整套買時，還沒有的單品打 8 折 */
const SETS = {
  set_sport: { name: '運動明星套裝', key: 'acc_trophy', items: ['hat_cap', 'coat_jersey', 'bottom_sport', 'acc_trophy'] },
  set_pirate: { name: '海上船長套裝', key: 'hat_captain', items: ['hat_captain', 'coat_pirate', 'bottom_pirate', 'pet_parrot'] },
  set_space: { name: '太空人套裝', key: 'hat_astro', items: ['hat_astro', 'coat_space', 'glove_space', 'pet_robot'] },
  set_magic: { name: '魔法學院套裝', key: 'coat_robe', items: ['hat_witch', 'coat_robe', 'glove_magic', 'pet_blackcat'] }
};
/* ---- 限定特價與每週新品 ----
 * 特價 3 天（LAUNCH_DAY 起）：衣櫃全部開放，價格是特價。
 * 特價結束後：原本的 18 樣和免費款一直都在；其他依 DROPS 每週一上架，上架後新品特價 3 天，之後恢復原價。
 *   學生已經買到的東西永遠是自己的，衣櫃裡一直看得到、可以穿。衣櫃只預告下一週的新品。
 * 原價：150 以下 ×2，151 以上 ×1.5（取 5 的倍數）；基礎色 4 金幣的每一欄只留一色 4 金幣，其他 10 金幣；
 *   免費款與徽章限定款不漲。 */
const LAUNCH_DAY = '2026-11-26', SALE_DAYS = 3;
const DROPS = {
  '2026-11-30': { name: '動物朋友', items: ['sp_cat', 'sp_bunny', 'sp_bear', 'sp_fox', 'sp_sheep', 'sp_dog', 'sp_pig', 'sp_mouse', 'ear_red', 'ear_yellow', 'ear_mint', 'ear_sky', 'ear_lav', 'ear_rainbow', 'pet_plushbunny', 'pet_chick', 'pet_hamster', 'pet_bunny'] },
  '2026-12-07': { name: '海洋冒險', items: ['bg_beach', 'bg_reef', 'bg_stars', 'bg_lighthouse', 'pet_gull', 'pet_crab', 'pet_octo', 'pet_lantern', 'pet_turtle', 'pet_fish', 'acc_scope', 'acc_backpack', 'coat_rain', 'hat_captain', 'coat_pirate', 'bottom_pirate', 'pet_parrot', 'acc_ring', 'acc_wheel'] },
  '2026-12-14': { name: '甜點娃娃', items: ['doll_popcorn', 'doll_cupcake', 'doll_strawberry', 'pet_popcorn', 'sp_full_cat', 'cheek_rose', 'cheek_peach', 'cheek_lilac', 'cheek_sky', 'cheek_shy', 'cheek_heart', 'cheek_star', 'cheek_rainbow', 'bottom_jeans', 'bottom_pleat', 'bottom_flower', 'bottom_tutu'] },
  '2026-12-21': { name: '冬天與運動', items: ['coat_down', 'coat_team', 'coat_denim', 'glove_white', 'glove_red', 'glove_boxing', 'hat_party', 'hat_chef', 'hat_cap', 'coat_jersey', 'bottom_sport', 'acc_trophy', 'pet_kitten', 'pet_puppy', 'eye_brown', 'eye_blue', 'eye_green', 'eye_gray'] },
  '2026-12-28': { name: '狗狗品種', items: ['sp_shiba', 'sp_husky', 'sp_dalmatian', 'sp_corgi', 'sp_poodle', 'sp_chihuahua', 'sp_schnauzer', 'sp_frog', 'sp_tiger', 'sp_panda', 'acc_headphones', 'acc_lei', 'eye_purple', 'eye_pink', 'eye_gold', 'eye_sparkle', 'eye_odd', 'hat_detective', 'sp_full_dog'] },
  '2027-01-04': { name: '貓咪與星星魔法', items: ['sp_calico', 'sp_tabby', 'sp_siamese', 'sp_scottish', 'sp_persian', 'hat_witch', 'coat_robe', 'glove_magic', 'pet_blackcat', 'acc_wand', 'coat_cape', 'glove_star', 'eye_star', 'hat_stars', 'color_night', 'pet_owl', 'pet_sprite'] },
  '2027-01-11': { name: '蔬果與太空', items: ['doll_carrot', 'doll_milk', 'doll_melon', 'hat_astro', 'coat_space', 'glove_space', 'pet_robot', 'sp_dino', 'hat_dino', 'sp_unicorn', 'pet_dragon', 'color_coral', 'color_cloud', 'bottom_plaid', 'bottom_suspender', 'bottom_grass', 'bottom_rainbow', 'acc_flag', 'sp_full_bunny'] },
  '2027-01-18': { name: '畢業典禮與皇家', items: ['doll_bachelor', 'doll_master', 'doll_doctor', 'hat_grad', 'hat_fedora', 'hat_fedora_black', 'hat_tophat', 'hat_starcrown', 'hat_royal', 'coat_royal', 'bottom_gown', 'glove_gold', 'eye_galaxy', 'sp_dragon', 'pet_whale', 'pet_phoenix', 'coat_rainbow', 'sp_full_bear'] },
  '2027-01-25': { name: '貼紙與調色盤', items: ['color_custom', 'sticker_heart', 'sticker_star', 'sticker_bolt', 'sticker_rainbow', 'sticker_moon', 'sticker_sun', 'sticker_flower', 'sticker_note', 'sticker_crown', 'sticker_anchor', 'sticker_clover', 'sticker_smile'] }
};
const DROP_OF = {};
Object.keys(DROPS).forEach(d => DROPS[d].items.forEach(id => { DROP_OF[id] = d; }));
const KEEP4 = new Set(['eye_brown', 'cheek_rose']);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function regularPrice(id) {
  const p = SHOP[id].price;
  if (!p || SHOP[id].need || SHOP[id].fixed) return p;
  if (p === 4) return KEEP4.has(id) ? 4 : 10;
  return p <= 150 ? p * 2 : Math.round(p * 1.5 / 5) * 5;
}
/** 衣櫃的「一天」從臺灣時間早上 8 點開始（特價、上架都在早上 8 點切換），也就是 UTC 的日期。
 * 測試可以用 SHOP_DAY 固定；特價開始日可以用 SALE_LAUNCH 改 */
const shopDay = ctx => (ctx.env && ctx.env.SHOP_DAY) || new Date().toISOString().slice(0, 10);
const launchDay = ctx => (ctx.env && ctx.env.SALE_LAUNCH) || LAUNCH_DAY;
/** 特價結束後的第一天 */
const saleOver = ctx => addDays(launchDay(ctx), SALE_DAYS);
/** 這一天買得到嗎：原本的東西一直都在；新東西特價開始前只能試穿，特價期間全部開放，之後要等上架日 */
const onShelf = (ctx, id, day) => !DROP_OF[id] || (!SHOP[id].hidden && day >= launchDay(ctx) && day < saleOver(ctx)) || day >= DROP_OF[id];
/** 下一批（特價結束後才有） */
function nextDrop(ctx, day) {
  const d = Object.keys(DROPS).sort().find(x => x > day && x >= saleOver(ctx));
  return d ? { day: d, name: DROPS[d].name, items: DROPS[d].items } : null;
}
/** 最近上架的一批（每週新品公告用） */
function lastDrop(ctx, day) {
  const d = Object.keys(DROPS).sort().filter(x => x <= day && x >= saleOver(ctx)).pop();
  return d ? { day: d, name: DROPS[d].name, items: DROPS[d].items } : null;
}
/** 這一天的價格：price 現在的價格、was 原價（特價中才有）、saleEnd 特價結束那天（早上 8 點結束）、soon 預告的上架日
 * 特價開始前維持原本的價格，不先漲價 */
function priceInfo(ctx, id, day) {
  const reg = regularPrice(id), L = launchDay(ctx), D = DROP_OF[id];
  const inLaunch = day >= L && day < saleOver(ctx), inDrop = !!D && day >= D && day < addDays(D, SALE_DAYS);
  const sale = (inLaunch || inDrop) && SHOP[id].price < reg;
  const end = inDrop ? addDays(D, SALE_DAYS) : saleOver(ctx);
  if (day < L) return { price: SHOP[id].price, was: 0, saleEnd: '', soon: DROP_OF[id] ? (SHOP[id].hidden ? D : L) : '' };
  return { price: sale ? SHOP[id].price : reg, was: sale ? reg : 0, saleEnd: sale ? end : '', soon: onShelf(ctx, id, day) ? '' : D };
}
/** 給學生看的衣櫃：買得到的、自己已經有的、下一週的預告 */
function shopView(ctx, have, isTest) {
  const day = shopDay(ctx), nx = nextDrop(ctx, day), mine = new Set(have || []), out = {};
  Object.keys(SHOP).forEach(id => {
    if (!isTest && !onShelf(ctx, id, day) && !mine.has(id) && !(nx && DROP_OF[id] === nx.day) && !(day < launchDay(ctx))) return;
    out[id] = Object.assign({}, SHOP[id], priceInfo(ctx, id, day));
    if (mine.has(id)) out[id].soon = '';  // 測試帳號看到的標示跟同學一樣，只是點了就能穿
    // 隱藏商品上架前：只給陰影，不給名字（測試帳號也一樣）
    if (SHOP[id].hidden && !onShelf(ctx, id, day) && !mine.has(id)) Object.assign(out[id], { name: '？？？神秘角色', mystery: true, stars: 0, badges: 0, need: '' });
  });
  return out;
}
/** 套裝：每一件都已經上架才顯示 */
const setsView = (ctx, isTest) => Object.fromEntries(Object.entries(SETS).filter(([, st]) => isTest || st.items.every(x => onShelf(ctx, x, shopDay(ctx)))));
/** 預告用的名字：隱藏商品寫成神秘角色 */
const dropName = x => SHOP[x].hidden ? '🎁 ？？？神秘角色' : SHOP[x].name;
/** 衣櫃狀態：特價倒數、下一週預告、這週新品 */
function shopInfo(ctx) {
  const day = shopDay(ctx), L = launchDay(ctx), over = saleOver(ctx);
  const ld = lastDrop(ctx, day), nx = nextDrop(ctx, day);
  return { day, launch: L, saleEnd: over, inLaunch: day >= L && day < over, beforeLaunch: day < L,
    drop: ld && day < addDays(ld.day, SALE_DAYS) ? { day: ld.day, name: ld.name, end: addDays(ld.day, SALE_DAYS), items: ld.items.map(x => SHOP[x].name) } : null,
    lastDrop: ld ? { day: ld.day, name: ld.name, items: ld.items.map(x => SHOP[x].name) } : null,
    next: nx ? { day: nx.day, name: nx.name, items: nx.items.map(dropName) } : null,
    // 上架行事曆：之後每一週上什麼（只給文字，不給圖）
    schedule: Object.keys(DROPS).sort().filter(d => d > day && d >= over).map(d => ({ day: d, name: DROPS[d].name, items: DROPS[d].items.map(dropName) })) };
}
/** 限定特價期間每人限買 SALE_LIMIT 樣（套裝算 1 樣、免費款不算）；active 表示現在在特價期間 */
const SALE_LIMIT = 5;
function saleQuota(ctx, s) {
  const day = shopDay(ctx), L = launchDay(ctx), active = day >= L && day < saleOver(ctx);
  const used = s.sale_key === L ? s.sale_buys : 0;
  return { active, used, left: Math.max(0, SALE_LIMIT - used), key: L };
}
const SALE_FULL = '特價期間每人限買 ' + SALE_LIMIT + ' 樣，你已經買滿了！其他的可以先試穿，特價結束後再用原價買。';
const setPrice = (ctx, set, have) => Math.round(set.items.filter(x => !have.includes(x)).reduce((a, x) => a + priceInfo(ctx, x, shopDay(ctx)).price, 0) * 0.8);
const badgeCount = async (ctx, cls, s) => (await ctx.first('SELECT COUNT(*) AS n FROM badges WHERE class_code = ? AND seat = ?', cls.code, s.seat)).n;
/** 指定徽章：物品寫了 need，就要先拿到那個徽章 */
async function checkNeed(ctx, cls, s, item, label) {
  if (!item.need) return;
  const got = await ctx.first('SELECT 1 AS ok FROM badges WHERE class_code = ? AND seat = ? AND badge = ?', cls.code, s.seat, item.need);
  if (!got) fail('要先拿到「' + ((BADGE_MAP[item.need] || {}).name || item.need) + '」徽章，才能買「' + label + '」。');
}
/* ---------- 主力島 ----------
 * 老師在系統設定勾選主力科目（預設國語、數學）：
 *   主力科目的題目答對 1 題得 1.5 枚金幣，主力科目的素養題 2 枚（一回合合計後四捨五入）；
 *   每日任務：每個主力科目各過關 1 回合，額外得 FOCUS_BONUS 金幣，累積天數算「國數雙修」徽章；
 *   focus_stamp 開著時，今日印章只在主力島過關才拿得到。
 * 算「在主力島過關」的島：主力科目的科目島、該科的單課練習、該科的素養島（素養:國語 這種）。 */
const FOCUS_RATE = 1.5, FOCUS_LIT_RATE = 2, FOCUS_BONUS = 5;
/* 考試範圍為主：老師設定考試（名稱、日期、範圍）時，範圍外的題目金幣乘上 outside_rate（預設 0.5，老師可以改）；
 * 印章、每日任務、精熟照算。段考衝刺島在考前 EXAM_BOOST_DAYS 天內，題目至少有主力島的金幣加成。 */
const OUTSIDE_RATE = 0.5, EXAM_BOOST_DAYS = 14;  // 主力科目的素養題（有情境的題組）2 倍
async function focusConf(ctx) {
  const set = await ctx.settings();
  const subj = jsonp(set.focus_subjects, null);
  const out = set.outside_rate === undefined || set.outside_rate === '' ? OUTSIDE_RATE : Math.min(1, Math.max(0, num(set.outside_rate)));
  return { subjects: Array.isArray(subj) ? subj.filter(x => SUBJECTS.includes(x)) : ['國語', '數學'], stamp: set.focus_stamp !== '0', outside: out };
}
/** 這座島是哪一科的主力島（不是就回傳空字串） */
function focusOf(island, subjects) {
  const x = String(island || '');
  const sj = SUBJECTS.includes(x) ? x : x.startsWith('單元:') ? x.slice(3).split('｜')[2] : x.startsWith('素養:') ? x.slice(3) : '';
  return sj && subjects.includes(sj) ? sj : '';
}
/** 今天的每日任務進度 */
const focusToday = s => s.focus_day === today() ? jsonp(s.focus_done, []) : [];

/** 星星：每天最多算幾顆（過關照樣算，超過只是不加星星） */
const STAR_DAILY_MAX = 5;
const DEFAULT_OUTFIT = { species: 'sp_seal', hat: 'hat_sailor', acc: 'acc_none', coat: 'coat_none', glove: 'glove_none', cheek: 'cheek_pink', eye: 'eye_dark', bottom: 'bottom_none', pet: 'pet_none', color: 'color_blue', bg: 'bg_none', ear: 'ear_same', doll: 'doll_none', sticker: 'sticker_none', flag: 'flag_none' };

/**
 * 徽章：每一個都要做到一件有意義的事，而且只拿一次。
 * 分成四類：好習慣（每天練）、精熟（真的記住）、成長（從錯誤中學）、挑戰。
 * 刻意不做「答很多題」「賺很多金幣」這種只靠刷題就能拿的徽章。
 */
const BADGES = [
  // 好習慣（series 相同的是同一系列，tier 是第幾階）
  { id: 'streak3', series: 'streak', tier: 1, group: '好習慣', icon: '🔥', name: '小火苗', desc: '連續 3 天拿到今日印章' },
  { id: 'streak7', series: 'streak', tier: 2, group: '好習慣', icon: '🔥', name: '一週不間斷', desc: '連續 7 天拿到今日印章' },
  { id: 'streak14', series: 'streak', tier: 3, group: '好習慣', icon: '⛵', name: '穩定航行', desc: '連續 14 天拿到今日印章' },
  { id: 'streak30', series: 'streak', tier: 4, group: '好習慣', icon: '👑', name: '航海王', desc: '連續 30 天拿到今日印章' },
  { id: 'streak60', series: 'streak', tier: 5, group: '好習慣', icon: '🌊', name: '乘風破浪', desc: '連續 60 天拿到今日印章' },
  { id: 'days10', series: 'days', tier: 1, group: '好習慣', icon: '📅', name: '十日水手', desc: '累積 10 天拿到今日印章' },
  { id: 'days30', series: 'days', tier: 2, group: '好習慣', icon: '📅', name: '三十日水手', desc: '累積 30 天拿到今日印章' },
  { id: 'days60', series: 'days', tier: 3, group: '好習慣', icon: '🧭', name: '老練水手', desc: '累積 60 天拿到今日印章' },
  { id: 'days100', series: 'days', tier: 4, group: '好習慣', icon: '🏝️', name: '百日水手', desc: '累積 100 天拿到今日印章' },
  { id: 'focus3', series: 'focus', tier: 1, group: '好習慣', icon: '🎯', name: '國數雙修', desc: '完成 3 天每日任務（主力島都過關）' },
  { id: 'focus10', series: 'focus', tier: 2, group: '好習慣', icon: '🎯', name: '雙島常客', desc: '完成 10 天每日任務（主力島都過關）' },
  { id: 'focus30', series: 'focus', tier: 3, group: '好習慣', icon: '🏹', name: '雙島霸主', desc: '完成 30 天每日任務（主力島都過關）' },
  { id: 'week5', group: '好習慣', icon: '🗓️', name: '全勤一週', desc: '同一週的週一到週五都拿到今日印章' },
  { id: 'month15', group: '好習慣', icon: '🌙', name: '月月有你', desc: '同一個月有 15 天拿到今日印章' },
  // 精熟
  { id: 'star10', series: 'star', tier: 1, group: '好習慣', icon: '⭐', name: '一閃一閃', desc: '累積 10 顆星星（每次過關得 1 顆）' },
  { id: 'star50', series: 'star', tier: 2, group: '好習慣', icon: '🌟', name: '星光點點', desc: '累積 50 顆星星' },
  { id: 'star100', series: 'star', tier: 3, group: '好習慣', icon: '💫', name: '滿天星', desc: '累積 100 顆星星' },
  { id: 'star300', series: 'star', tier: 4, group: '好習慣', icon: '🌠', name: '流星雨', desc: '累積 300 顆星星' },
  { id: 'star500', series: 'star', tier: 5, group: '好習慣', icon: '🌌', name: '銀河旅人', desc: '累積 500 顆星星' },
  { id: 'master1', series: 'master', tier: 1, group: '精熟', icon: '🌱', name: '第一棵樹', desc: '第一次精熟一個單元' },
  { id: 'master5', series: 'master', tier: 2, group: '精熟', icon: '🌳', name: '小樹林', desc: '精熟 5 個單元' },
  { id: 'master10', series: 'master', tier: 3, group: '精熟', icon: '🌲', name: '森林守護者', desc: '精熟 10 個單元' },
  { id: 'master20', series: 'master', tier: 4, group: '精熟', icon: '🏞️', name: '知識森林', desc: '精熟 20 個單元' },
  { id: 'master30', series: 'master', tier: 5, group: '精熟', icon: '🏔️', name: '知識山脈', desc: '精熟 30 個單元' },
  { id: 'master50', series: 'master', tier: 6, group: '精熟', icon: '🌍', name: '知識大陸', desc: '精熟 50 個單元' },
  { id: 'climb', group: '精熟', icon: '👣', name: '一步一腳印', desc: '一個曾經答錯過的單元，一路練到精熟' },
  { id: 'longmem1', series: 'longmem', tier: 1, group: '精熟', icon: '🧠', name: '長期記憶', desc: '一題隔了 21 天以上再答，還是答對' },
  { id: 'longmem10', series: 'longmem', tier: 2, group: '精熟', icon: '🧠', name: '記憶小達人', desc: '隔了 21 天以上再答還答對的題目，累積 10 題' },
  { id: 'longmem30', series: 'longmem', tier: 3, group: '精熟', icon: '🧠', name: '記憶大師', desc: '隔了 21 天以上再答還答對的題目，累積 30 題' },
  { id: 'unitperfect', group: '精熟', icon: '💯', name: '完美單元', desc: '一個單元的每一題都記住了（那個單元要有 5 題以上，素養題組不算）' },
  { id: 'isle_國語', group: '精熟', icon: '📜', name: '國語島主', desc: '國語島開放的單元全部精熟（至少 2 個單元）' },
  { id: 'isle_數學', group: '精熟', icon: '📐', name: '數學島主', desc: '數學島開放的單元全部精熟（至少 2 個單元）' },
  { id: 'isle_自然', group: '精熟', icon: '🔬', name: '自然島主', desc: '自然島開放的單元全部精熟（至少 2 個單元）' },
  { id: 'isle_社會', group: '精熟', icon: '🗺️', name: '社會島主', desc: '社會島開放的單元全部精熟（至少 2 個單元）' },
  { id: 'isle_英文', group: '精熟', icon: '🔤', name: '英文島主', desc: '英文島開放的單元全部精熟（至少 2 個單元）' },
  { id: 'allfive', group: '精熟', icon: '🌈', name: '五島通航', desc: '五科都至少精熟 1 個單元' },
  // 成長
  { id: 'rescue10', series: 'rescue', tier: 1, group: '成長', icon: '🛟', name: '救援小隊', desc: '把 10 題答錯過的題目重新答對' },
  { id: 'rescue50', series: 'rescue', tier: 2, group: '成長', icon: '🚁', name: '救援隊長', desc: '把 50 題答錯過的題目重新答對' },
  { id: 'rescue100', series: 'rescue', tier: 3, group: '成長', icon: '🦸', name: '救援英雄', desc: '把 100 題答錯過的題目重新答對' },
  { id: 'rescue200', series: 'rescue', tier: 4, group: '成長', icon: '🏅', name: '救援傳奇', desc: '把 200 題答錯過的題目重新答對' },
  { id: 'clearwrong', group: '成長', icon: '🧹', name: '錯題清零', desc: '錯題礁有 5 題以上時，全部救回來變成 0 題' },
  { id: 'concept', group: '成長', icon: '💡', name: '觀念突破', desc: '一個答錯過 3 次以上的觀念，後來連續答對 5 題' },
  { id: 'comeback', group: '成長', icon: '💪', name: '越挫越勇', desc: '同一天沒過關之後，再挑戰並過關' },
  { id: 'review', group: '成長', icon: '⏰', name: '溫故知新', desc: '回去複習一個「該複習了」的精熟單元，並答對' },
  // 挑戰
  { id: 'reader10', series: 'reader', tier: 1, group: '挑戰', icon: '📖', name: '閱讀偵探', desc: '答對 10 題素養題' },
  { id: 'reader30', series: 'reader', tier: 2, group: '挑戰', icon: '🔎', name: '情境高手', desc: '答對 30 題素養題' },
  { id: 'reader60', series: 'reader', tier: 3, group: '挑戰', icon: '📚', name: '素養達人', desc: '答對 60 題素養題' },
  { id: 'groupall', group: '挑戰', icon: '🧩', name: '題組全對', desc: '一組素養題組（3 題以上）每一題都答對' },
  { id: 'litfive', group: '挑戰', icon: '🌺', name: '素養五島', desc: '五科的素養島，都至少有一組題組每一題最近一次都答對' },
  { id: 'explorer5', series: 'explorer', tier: 1, group: '挑戰', icon: '🔭', name: '小小探險家', desc: '完成 5 個延伸冒險' },
  { id: 'explorer15', series: 'explorer', tier: 2, group: '挑戰', icon: '🏕️', name: '探險隊長', desc: '完成 15 個延伸冒險' },
  { id: 'perfect', group: '挑戰', icon: '🎯', name: '百發百中', desc: '一整回合每一題都答對（那一回合要有 8 題以上）' },
  { id: 'lighthouse', group: '挑戰', icon: '🗼', name: '燈塔全對', desc: '燈塔挑戰一整回合每一題都答對，一題都沒錯（那一回合要有 5 題以上）' },
  { id: 'exam', group: '挑戰', icon: '🚩', name: '備戰完成', desc: '在段考衝刺島過關' },
  { id: 'prepared', series: 'prepared', tier: 1, group: '挑戰', icon: '🎒', name: '有備而來', desc: '段考前，考試範圍有 7 成題目最近一次答對' },
  { id: 'prepared90', series: 'prepared', tier: 2, group: '挑戰', icon: '🎓', name: '滿分準備', desc: '段考前，考試範圍有 9 成題目最近一次答對' },
  // AI 素養
  { id: 'detective1', series: 'detective', tier: 1, group: 'AI 素養', icon: '🕵️', name: '題目偵探', desc: '回報的題目被老師確認真的有問題（老師修改或停用了那題）' },
  { id: 'detective3', series: 'detective', tier: 2, group: 'AI 素養', icon: '🔍', name: '細心查證員', desc: '被老師確認的回報累積 3 次' },
  { id: 'bughunt1', series: 'bughunt', tier: 1, group: 'AI 素養', icon: '🛠️', name: '系統偵探', desc: '提問時找到網站真的有問題，被老師確認' },
  { id: 'bughunt3', series: 'bughunt', tier: 2, group: 'AI 素養', icon: '🧰', name: '除錯小幫手', desc: '找到網站的問題，被老師確認累積 3 次' }
];
const BADGE_MAP = Object.fromEntries(BADGES.map(b => [b.id, b]));

class UserError extends Error {}
const fail = msg => { throw new UserError(msg); };

/* ================= 入口 ================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 題目圖片：/img/<id>（內容不會變，可以讓瀏覽器長期快取）
    if (url.pathname.startsWith('/img/')) {
      const id = url.pathname.slice(5).replace(/[^A-Za-z0-9_-]/g, '');
      const r = id && await env.DB.prepare('SELECT mime, data FROM images WHERE id = ?').bind(id).first();
      if (!r) return new Response('Not found', { status: 404 });
      const bin = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
      return new Response(bin, { headers: { 'content-type': r.mime, 'cache-control': 'public, max-age=31536000, immutable' } });
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const name = url.pathname.slice(5);
    const fn = API[name];
    if (!fn || request.method !== 'POST') return json({ err: '找不到這個功能。' }, 404);
    let args = [];
    try { args = ((await request.json()) || {}).args || []; } catch (e) { return json({ err: '資料格式不對。' }, 400); }
    try {
      const ctx = new Ctx(env);
      ctx.ip = request.headers.get('cf-connecting-ip') || 'local';
      ctx.importToken = request.headers.get('x-import-token') || '';
      const out = await fn(ctx, ...args);
      if (BANK_WRITERS.has(name)) await bumpBank(ctx);
      const res = json({ ok: out ?? null }); res.headers.set('x-rows-read', String(ctx.rows)); return res;
    } catch (e) {
      if (e instanceof UserError) return json({ err: e.message }, 200);
      console.error(name, e && e.stack || e);
      return json({ err: '系統發生錯誤，請稍後再試。' }, 500);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/* ================= 共用 ================= */

class Ctx {
  constructor(env) { this.env = env; this.db = env.DB; this._set = null; this.rows = 0; }
  // rows 累計這次請求讀了幾列（D1 免費方案每天有讀取上限，回應標頭 X-Rows-Read 會帶出來方便檢查）
  all(sql, ...p) { return this.db.prepare(sql).bind(...p).all().then(r => { const n = (r.meta && r.meta.rows_read) || 0; this.rows += n; if (this.env.DEBUG_ROWS && n > 200) console.log('ROWS', n, sql.replace(/\s+/g, ' ').slice(0, 140)); return r.results; }); }
  first(sql, ...p) { return this.all(sql, ...p).then(r => r[0] || null); }
  run(sql, ...p) { return this.db.prepare(sql).bind(...p).run().then(r => { this.rows += (r.meta && r.meta.rows_read) || 0; return r; }); }
  stmt(sql, ...p) { return this.db.prepare(sql).bind(...p); }
  async batch(list) { for (let i = 0; i < list.length; i += 50) await this.db.batch(list.slice(i, i + 50)); }
  async settings() {
    if (!this._set) {
      this._set = {};
      (await this.all('SELECT key, value FROM settings')).forEach(r => this._set[r.key] = r.value);
    }
    return this._set;
  }
}

// 臺灣時間
const twNow = () => new Date(Date.now() + 8 * 3600e3);
const today = () => twNow().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() + 8 * 3600e3 - 864e5).toISOString().slice(0, 10);
const stampNow = () => twNow().toISOString().slice(0, 19).replace('T', ' ');
const num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const jsonp = (v, d) => { try { const x = JSON.parse(v || ''); return x == null ? d : x; } catch (e) { return d; } };
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const up = s => str(s, 40).toUpperCase();
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const unitKey = q => (str(q.version) || COMMON) + '｜' + q.grade + q.sem + '｜' + q.subject + '｜' + q.unit;
const concepts = c => String(c || '').split(/[、,，|]/).map(x => x.trim()).filter(Boolean);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

async function rate(ctx) {
  const s = await ctx.settings();
  const v = (k, d) => (s[k] === undefined || s[k] === '') ? d : Math.max(0, num(s[k]));
  return { perStamp: v('per_stamp', 1), coinsPerPoint: v('coins_per_point', 20), perMastery: v('per_mastery', 0) };
}

/* ---------- 老師登入 ---------- */

/**
 * 老師密碼檢查。輸錯會依「網路位址」分開計算：學生在自己的裝置亂試，
 * 只會鎖住那台裝置，不會讓老師也進不去。
 */
async function checkPw(ctx, pw) {
  const s = await ctx.settings();
  const now = Date.now();
  const who = (await sha256('ip:' + ctx.ip)).slice(0, 16);
  const kFails = 'tfails_' + who, kLock = 'tlock_' + who;
  if (num(s[kLock]) > now) fail('這台裝置輸錯太多次，請 10 分鐘後再試。');
  pw = String(pw || '');
  let ok;
  if (s.teacher_pw_hash) ok = safeEqual(await sha256(s.teacher_pw_salt + pw), s.teacher_pw_hash);
  else ok = !!ctx.env.TEACHER_PASSWORD && safeEqual(pw, ctx.env.TEACHER_PASSWORD);
  const put = (k, v) => ctx.stmt('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  if (!ok) {
    const fails = num(s[kFails]) + 1;
    await ctx.batch(fails >= TEACHER_MAX_FAILS ? [put(kFails, 0), put(kLock, now + LOCK_MS)] : [put(kFails, fails)]);
    ctx._set = null;
    if (!s.teacher_pw_hash && !ctx.env.TEACHER_PASSWORD) fail('還沒設定老師密碼，請依照使用說明在 GitHub 設定 TEACHER_PASSWORD。');
    fail(fails >= TEACHER_MAX_FAILS ? '這台裝置輸錯太多次，請 10 分鐘後再試。' : '老師密碼不正確。');
  }
  if (s[kFails] !== undefined || s[kLock] !== undefined) {
    await ctx.run('DELETE FROM settings WHERE key IN (?, ?)', kFails, kLock);
    ctx._set = null;
  }
}

/* ---------- 學生登入 ---------- */

async function findClass(ctx, code) {
  const c = await ctx.first('SELECT * FROM classes WHERE code = ?', up(code));
  if (!c) fail('找不到班級代碼「' + str(code, 20) + '」。');
  return c;
}

async function auth(ctx, cred, allowSetPin) {
  cred = cred || {};
  const cls = await findClass(ctx, cred.code);
  if (cls.status !== '進行中') fail('這個班級已經結業封存了。');
  const seat = Math.floor(num(cred.seat));
  const s = await ctx.first('SELECT * FROM students WHERE class_code = ? AND seat = ?', cls.code, seat);
  if (!s) fail('這個班級沒有 ' + seat + ' 號，請跟老師確認。');
  const now = Date.now();
  if (s.locked_until > now) fail('密碼錯太多次了，請 ' + Math.ceil((s.locked_until - now) / 60e3) + ' 分鐘後再試，或請老師幫你重設。');
  const given = str(cred.pin, 10);
  if (!s.pin) {
    if (!allowSetPin) fail('請重新登入。');
    if (!/^\d{4}$/.test(given)) fail('第一次登入請自己設定 4 位數字密碼。');
    s.pin = given;
    s.nick = str(cred.nick, 10) || s.nick;
    await ctx.run('UPDATE students SET pin = ?, nick = ? WHERE class_code = ? AND seat = ?', s.pin, s.nick, cls.code, seat);
  } else if (!safeEqual(s.pin, given)) {
    const fails = s.fails + 1;
    if (fails >= MAX_FAILS) await ctx.run('UPDATE students SET fails = 0, locked_until = ? WHERE class_code = ? AND seat = ?', now + LOCK_MS, cls.code, seat);
    else await ctx.run('UPDATE students SET fails = ? WHERE class_code = ? AND seat = ?', fails, cls.code, seat);
    fail(fails >= MAX_FAILS ? '密碼錯太多次了，請 10 分鐘後再試，或請老師幫你重設。' : '密碼不對喔。忘記的話請老師幫你重設。');
  }
  if (s.fails) await ctx.run('UPDATE students SET fails = 0 WHERE class_code = ? AND seat = ?', cls.code, seat);
  return { cls, s };
}

const owned = s => jsonp(s.owned, []).filter(id => SHOP[id]);
function outfit(s) {
  const o = jsonp(s.outfit, {});
  const out = {};
  Object.keys(DEFAULT_OUTFIT).forEach(k => out[k] = SHOP[o[k]] ? o[k] : DEFAULT_OUTFIT[k]);
  return out;
}
function liveStreak(s) { return (s.last_day === today() || s.last_day === yesterday()) ? s.streak : 0; }

/** 題目池：在這些單元裡、已啟用的題目 */
/* ---------- 題庫快取 ----------
 * 題目只有在匯入、編輯、停用、刪除時才會變。整個題庫讀一次後留在記憶體，
 * 用 settings 的 qver（題庫版本）判斷要不要重讀，大幅減少資料庫讀取（D1 免費方案每天有讀取上限）。 */
let QCACHE = null;
async function bank(ctx) {
  if (ctx._bank) return ctx._bank;
  const ver = (await ctx.settings()).qver || '0';
  if (!QCACHE || QCACHE.ver !== ver) {
    const rows = await ctx.all('SELECT * FROM questions');
    const byId = new Map(), byUnit = new Map();
    rows.forEach(q => { byId.set(q.id, q); if (!byUnit.has(q.unit_key)) byUnit.set(q.unit_key, []); byUnit.get(q.unit_key).push(q); });
    QCACHE = { ver, rows, byId, byUnit };
  }
  return (ctx._bank = QCACHE);
}
async function bumpBank(ctx) {
  const v = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await ctx.run("INSERT INTO settings (key, value) VALUES ('qver', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", v);
  QCACHE = null; ctx._bank = null; if (ctx._set) ctx._set.qver = v;
}
const BANK_WRITERS = new Set(['tImport', 'xImportQuestions', 'tSaveQuestion', 'tSetEnabled', 'tDeleteQuestions', 'tRenameUnit']);

async function poolFor(ctx, units) {
  if (!units || !units.length) return [];
  const b = await bank(ctx), out = [];
  [...new Set(units)].forEach(k => (b.byUnit.get(k) || []).forEach(q => { if (q.enabled === 1) out.push(q); }));
  return out;
}

/** 每一題的作答狀況：last 最近一次對錯、days 答對過的不同日子數、rday 最後答對日、day 最後作答日 */
/* 作答紀錄暫存在伺服器記憶體：只有交卷會改作答紀錄，交卷也會讓 students.total 變大，
 * 所以用 total 當版本號：total 沒變就直接用暫存的，變了（例如在別台伺服器交過卷）就重讀資料庫。
 * 出題和交卷通常在同一台伺服器，一回合可以少讀一次整份作答紀錄。
 * 注意：如果直接改資料庫的 progress，也要讓那位學生的 total 變一下（或等 30 分鐘、重新部署），暫存才會更新。 */
const HCACHE = new Map(), HCACHE_MS = 30 * 60e3, HCACHE_MAX = 400;
function hcachePut(mk, total, h) {
  HCACHE.delete(mk); HCACHE.set(mk, { total, h, t: Date.now() });
  if (HCACHE.size > HCACHE_MAX) HCACHE.delete(HCACHE.keys().next().value);  // 刪最舊的
}
async function history(ctx, code, seat, total) {
  const mk = code + '|' + seat; ctx._hist = ctx._hist || {};
  if (ctx._hist[mk]) return ctx._hist[mk];
  const c = HCACHE.get(mk);
  if (total != null && c && c.total === total && Date.now() - c.t < HCACHE_MS) return (ctx._hist[mk] = c.h);
  const h = (ctx._hist[mk] = {});
  (await ctx.all('SELECT qid, last_ok, right_days, last_right_day, last_day FROM progress WHERE class_code = ? AND seat = ?', code, seat))
    .forEach(r => h[r.qid] = { last: r.last_ok === 1, days: r.right_days, rday: r.last_right_day, day: r.last_day });
  if (total != null) hcachePut(mk, total, h);
  return h;
}

/* ---------- 精熟制度 ----------
 * 一題「記住了」：在兩個不同的日子都答對過，而且最近一次是答對的。
 * 單元等級（只看「記住」的比例，素養題組不算）：
 *   0 還沒練   1 發芽 🌱 有練習   2 長葉 🌿 記住 3 成   3 茁壯 🪴 記住 6 成   4 精熟 🌳 記住 9 成
 * 精熟過的單元一直算精熟（記在 mastery 表），之後答錯或題目變多，只另外提醒還有幾題要再答對。
 * 已精熟的單元超過 21 天沒練習，會提醒複習（等級不會被扣）。
 */
const LEVEL_RATIOS = [0, 0, 0.3, 0.6, 0.9], MASTER = 4, MASTER_RATIO = 0.9, REVIEW_DAYS = 21;
const remembered = h => !!h && h.last && h.days >= 2;
function unitLevels(pool, hist) {
  const by = {};
  pool.forEach(q => {
    if (q.passage) return;  // 素養題組不算進單元精熟，在素養島另外計算
    const u = by[q.unit_key] = by[q.unit_key] || { key: q.unit_key, subject: q.subject, unit: q.unit, total: 0, tried: 0, right: 0, remembered: 0, once: 0, lit: 0, lastDay: '' };
    const h = hist[q.id];
    u.total++; if (q.passage) u.lit++;
    if (h) { u.tried++; if (h.last) u.right++; if (remembered(h)) u.remembered++; else if (h.last) u.once++; if (h.day > u.lastDay) u.lastDay = h.day; }
  });
  const reviewBefore = new Date(Date.now() + 8 * 3600e3 - REVIEW_DAYS * 864e5).toISOString().slice(0, 10);
  return Object.keys(by).map(k => {
    const u = by[k];
    const r = u.total ? u.remembered / u.total : 0;
    u.rawLevel = !u.tried ? 0 : r >= LEVEL_RATIOS[4] - 1e-9 ? 4 : r >= LEVEL_RATIOS[3] - 1e-9 ? 3 : r >= LEVEL_RATIOS[2] - 1e-9 ? 2 : 1;
    u.level = u.rawLevel;
    u.reviewBefore = reviewBefore;
    return u;
  });
}
/** 套用「精熟過就一直算精熟」，並算出複習提醒與下一級還差幾題 */
function finishLevels(units, had) {
  return units.map(u => {
    u.level = had && had.has(u.key) ? MASTER : u.rawLevel;
    u.review = u.level === MASTER && !!u.lastDay && u.lastDay < u.reviewBefore;
    const need = ratio => Math.max(0, Math.ceil(u.total * ratio - 1e-9) - u.remembered);
    u.needMaster = need(MASTER_RATIO);
    u.needNext = u.level < MASTER ? need(LEVEL_RATIOS[Math.max(2, u.level + 1)]) : 0;
    u.again = u.level === MASTER ? u.needMaster : 0;  // 精熟過，但後來答錯或題目變多，還要再答對幾題
    return u;
  });
}

function exam(cls) {
  const units = jsonp(cls.exam_units, []);
  if (!cls.exam_date || !units.length || cls.exam_date < today()) return null;
  const days = Math.round((Date.parse(cls.exam_date + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 864e5);
  return { name: cls.exam_name || '段考', date: cls.exam_date, units, days };
}

async function state(ctx, cls, s) {
  const pool = await poolFor(ctx, jsonp(cls.units, []));
  const hist = await history(ctx, cls.code, s.seat, s.total);
  const islands = {};
  // 科目島的數字和精熟圖鑑一致：記住幾題 / 這科全部題數（含素養題組）；practice 是科目島能出的一般題
  SUBJECTS.forEach(sj => islands[sj] = { total: 0, mastered: 0, practice: 0, lit: 0 });
  // 素養島：有閱讀情境的題組集中在這裡，依科目分開
  const literacy = {}, litSets = {};
  SUBJECTS.forEach(sj => { literacy[sj] = { groups: 0, total: 0, mastered: 0, allRight: 0 }; litSets[sj] = new Set(); });
  let wrong = 0;
  pool.forEach(q => {
    const h = hist[q.id];
    const lt = q.passage ? literacy[q.subject] : null, is = islands[q.subject];
    if (lt) { lt.total++; if (remembered(h)) lt.mastered++; }
    if (is && !q.passage) { is.total++; is.practice++; if (remembered(h)) is.mastered++; }
    if (q.passage && litSets[q.subject]) litSets[q.subject].add(q.passage);
    if (h && !h.last) wrong++;
  });
  SUBJECTS.forEach(sj => literacy[sj].groups = litSets[sj].size);
  // 每一組題組：每一題最近一次都答對（素養五島徽章用）
  const grpOk = {};
  pool.forEach(q => { if (!q.passage || !literacy[q.subject]) return; const k = q.subject + '\u0001' + q.passage, h = hist[q.id]; grpOk[k] = (grpOk[k] ?? true) && !!h && h.last; });
  Object.keys(grpOk).forEach(k => { if (grpOk[k]) literacy[k.split('\u0001')[0]].allRight++; });
  let ex = exam(cls);
  if (ex) {
    const ep = await poolFor(ctx, ex.units);
    ex = { name: ex.name, date: ex.date, days: ex.days, units: ex.units, boost: ex.days <= EXAM_BOOST_DAYS, total: ep.length, mastered: ep.filter(q => hist[q.id] && hist[q.id].last).length };
  }
  const set = await ctx.settings();
  const sortOf = {}; (await unitCatalog(ctx)).forEach(u => sortOf[u.key] = u.sort);
  const practice = {}; pool.forEach(q => { if (!q.passage) practice[q.unit_key] = (practice[q.unit_key] || 0) + 1; });
  const had = new Set((await ctx.all('SELECT unit_key FROM mastery WHERE class_code = ? AND seat = ?', cls.code, s.seat)).map(r => r.unit_key));
  const units = finishLevels(unitLevels(pool, hist), had).map(u => ({ key: u.key, subject: u.subject, unit: u.unit, level: u.level, rawLevel: u.rawLevel, review: u.review, total: u.total, remembered: u.remembered, right: u.right, once: u.once, wrong: u.tried - u.right, practice: practice[u.key] || 0,
    needMaster: u.needMaster, needNext: u.needNext, again: u.again }))
    .sort((a, b) => SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject) || (sortOf[a.key] ?? 1e6) - (sortOf[b.key] ?? 1e6) || a.unit.localeCompare(b.unit, 'zh-Hant'));
  const linkRows = await ctx.all('SELECT unit_key FROM links WHERE unit_key IN (SELECT value FROM json_each(?))', linkKeys(cls));
  SUBJECTS.forEach(sj => {
    islands[sj].links = linkRows.filter(r => r.unit_key.split('｜')[2] === sj).length;
    const us = units.filter(u => u.subject === sj);
    islands[sj].units = us.length; islands[sj].masteredUnits = us.filter(u => u.level === MASTER).length;
  });
  const brows = await ctx.all('SELECT badge, note, day FROM badges WHERE class_code = ? AND seat = ?', cls.code, s.seat);
  const badges = brows.map(r => r.badge);
  const custom = await customBadges(ctx);
  const badgeNotes = {};
  const badgeDays = {};
  brows.forEach(r => { if (r.note) badgeNotes[r.badge] = r.note; badgeDays[r.badge] = r.day; });
  return {
    units, badges, badgeNotes, badgeDays, badgeList: BADGES.concat(custom), credit: set.credit || '',
    notice: cls.notice && (!cls.notice_until || today() <= cls.notice_until) ? cls.notice : '', mission: cls.mission || '', showLeaderboard: set.show_leaderboard !== '0',
    className: cls.name, seat: s.seat, nick: s.nick,
    coins: s.coins, earned: s.earned, stars: s.stars, stamps: s.stamps,
    streak: liveStreak(s), todayDone: s.last_day === today(), starToday: s.star_day === today() ? s.star_today : 0, starMax: STAR_DAILY_MAX, newsSeen: s.news_seen || '',
    islands, literacy, wrong, exam: ex, perRound: num(set.per_round) || 10, passRatio: num(set.pass_ratio) || 0.7,
    owned: owned(s), outfit: outfit(s), shop: shopView(ctx, owned(s), !!s.is_test), sets: setsView(ctx, !!s.is_test), shopInfo: shopInfo(ctx), isTest: !!s.is_test, focus: Object.assign(await focusConf(ctx), { done: focusToday(s), bonus: FOCUS_BONUS, rate: FOCUS_RATE, litRate: FOCUS_LIT_RATE, days: s.focus_days || 0 }), customColor: s.custom_color || '', saves: { slots: s.save_slots || 0, list: jsonp(s.saved, []), prices: SAVE_PRICES },  saleLeft: (q => q.active ? q.left : null)(saleQuota(ctx, s)), saleLimit: SALE_LIMIT
  };
}

// 選項有「以上皆是」這類依位置的寫法時，不打亂順序
const FIXED_ORDER = /以上|皆是|皆非|都對|都不對|都是|都不是|all of the above|none of the above/i;

/** 給學生的題目：選擇題每次打亂選項順序，答案字母跟著換 */
function publicQ(q) {
  const out = { id: q.id, subject: q.subject, unit: q.unit, concept: q.concept, type: q.type, text: q.text, passage: q.passage || '', image: q.image ? '/img/' + q.image : '', answer: q.answer, explain: q.explain, hint: q.hint || '' };
  if (q.type !== '選擇') return Object.assign(out, { options: [] });
  let opts = ['A', 'B', 'C', 'D'].map(k => ({ k, t: q[k.toLowerCase()] })).filter(o => o.t);
  if (!opts.some(o => FIXED_ORDER.test(o.t))) opts = shuffle(opts);
  out.options = opts.map(o => o.t);
  out.answer = 'ABCD'[Math.max(0, opts.findIndex(o => o.k === String(q.answer).toUpperCase()))];
  return out;
}

function normAns(v) {
  return String(v == null ? '' : v).replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, '').toLowerCase();
}
function tf(v) {
  const s = normAns(v);
  if (['o', '○', '對', '是', 't', 'true', 'y', '⭕'].includes(s)) return 'O';
  if (['x', '╳', '×', '錯', '否', 'f', 'false', 'n', '❌'].includes(s)) return 'X';
  return null;
}
function grade(q, ans) {
  // 選擇題：學生送回選項的文字（因為每個人看到的順序不同），比對正確選項的內容
  if (q.type === '選擇') {
    const right = q[String(q.answer).toLowerCase()];
    if (right == null || right === '') return false;
    // 舊版頁面（還沒重新整理）送的是原始順序的字母
    if (/^[A-Da-d]$/.test(String(ans).trim()) && ![q.a, q.b, q.c, q.d].some(t => normAns(t) === normAns(ans))) return normAns(ans).toUpperCase() === normAns(q.answer).toUpperCase();
    return normAns(ans) === normAns(right);
  }
  if (q.type === '是非') return tf(ans) !== null && tf(ans) === tf(q.answer);
  return String(q.answer).split('|').some(r => normAns(r) !== '' && normAns(r) === normAns(ans));
}

/* ================= API ================= */

const API = {};

/* ---------- 學生 ---------- */

API.studentLogin = async (ctx, cred) => {
  const { cls, s } = await auth(ctx, cred, true);
  const st = await state(ctx, cls, s);
  // 登入時才讀：老師的新回覆、旗子
  [st.askNews, st.flag] = await Promise.all([askNews(ctx, cls, s), flagState(ctx, cls, s)]);
  const nb = await awardBadges(ctx, cls, s, st, {});
  if (nb.length) st.badges = st.badges.concat(nb.map(b => b.id));
  return st;
};

/** 老師自己建立的徽章（id 以 c: 開頭），放在「老師頒發」這一類 */
async function customBadges(ctx) {
  return (await ctx.all('SELECT * FROM custom_badges ORDER BY created, id')).map(c => ({ id: 'c:' + c.id, group: '老師頒發', icon: c.icon, name: c.name, desc: c.descr || '老師頒發的特別徽章', custom: true }));
}

/** 檢查並頒發徽章，回傳這次新拿到的 */
async function awardBadges(ctx, cls, s, st, ev) {
  const have = new Set(st.badges || []);
  const [m, det, lk] = await Promise.all([
    ctx.first('SELECT COUNT(*) AS n FROM mastery WHERE class_code = ? AND seat = ?', cls.code, s.seat),
    ctx.first("SELECT COUNT(DISTINCT qid) AS n FROM reports WHERE class_code = ? AND seat = ? AND status = 'confirmed'", cls.code, s.seat),
    ctx.first('SELECT COUNT(*) AS n FROM link_done WHERE class_code = ? AND seat = ?', cls.code, s.seat)
  ]);
  const mastered = m.n, detective = det.n, explored = lk.n;
  const subj = sj => st.units.filter(u => u.subject === sj);
  // 拿到今日印章的日期：同一週週一到週五、同一個月 15 天
  const days = new Set(jsonp(s.stamp_days, []));
  const d0 = new Date(today() + 'T00:00:00Z'), dow = (d0.getUTCDay() + 6) % 7;  // 0 = 週一
  const monday = new Date(d0.getTime() - dow * 864e5);
  const week5 = [0, 1, 2, 3, 4].every(i => days.has(new Date(monday.getTime() + i * 864e5).toISOString().slice(0, 10)));
  const month15 = [...days].filter(d => d.slice(0, 7) === today().slice(0, 7)).length >= 15;
  const ex = st.exam;
  const cond = {
    star10: s.stars >= 10, star50: s.stars >= 50, star100: s.stars >= 100, star300: s.stars >= 300, star500: s.stars >= 500,
    streak3: s.streak >= 3, streak7: s.streak >= 7, streak14: s.streak >= 14, streak30: s.streak >= 30, streak60: s.streak >= 60,
    focus3: (s.focus_days || 0) >= 3, focus10: (s.focus_days || 0) >= 10, focus30: (s.focus_days || 0) >= 30,
    days10: s.stamps >= 10, days30: s.stamps >= 30, days60: s.stamps >= 60, days100: s.stamps >= 100, week5, month15,
    master1: mastered >= 1, master5: mastered >= 5, master10: mastered >= 10, master20: mastered >= 20, master30: mastered >= 30, master50: mastered >= 50,
    longmem1: s.longmem >= 1, longmem10: s.longmem >= 10, longmem30: s.longmem >= 30,
    unitperfect: st.units.some(u => u.total >= 5 && u.remembered === u.total),
    allfive: SUBJECTS.every(sj => subj(sj).some(u => u.level === MASTER)),
    rescue10: s.rescued >= 10, rescue50: s.rescued >= 50, rescue100: s.rescued >= 100, rescue200: s.rescued >= 200,
    reader10: s.passage_right >= 10, reader30: s.passage_right >= 30, reader60: s.passage_right >= 60,
    prepared: !!ex && ex.total >= 5 && ex.mastered / ex.total >= 0.7, prepared90: !!ex && ex.total >= 5 && ex.mastered / ex.total >= 0.9,
    litfive: SUBJECTS.every(sj => st.literacy && st.literacy[sj] && st.literacy[sj].allRight >= 1),
    explorer5: explored >= 5, explorer15: explored >= 15,
    detective1: detective >= 1, detective3: detective >= 3, bughunt1: (s.bugs || 0) >= 1, bughunt3: (s.bugs || 0) >= 3,
    comeback: !!ev.comeback, review: !!ev.review, perfect: !!ev.perfect, exam: !!ev.exam,
    climb: !!ev.climb, clearwrong: !!ev.clearwrong, concept: !!ev.concept, groupall: !!ev.groupall, lighthouse: !!ev.lighthouse
  };
  SUBJECTS.forEach(sj => { const us = subj(sj); cond['isle_' + sj] = us.length >= 2 && us.every(u => u.level === MASTER); });
  const fresh = BADGES.filter(b => cond[b.id] && !have.has(b.id));
  if (fresh.length) await ctx.batch(fresh.map(b => ctx.stmt('INSERT OR IGNORE INTO badges (class_code, seat, badge, day) VALUES (?,?,?,?)', cls.code, s.seat, b.id, today())));
  return fresh;
}

API.getRound = async (ctx, cred, island) => {
  const { cls, s } = await auth(ctx, cred, false);
  const set = await ctx.settings();
  const n = Math.min(30, num(set.per_round) || 10);
  const hist = await history(ctx, cls.code, s.seat, s.total);
  const isWrong = q => hist[q.id] && !hist[q.id].last;
  const td = today();
  // 出題順序：錯題（最多 3 題）→ 之前答對過一天、今天還沒答對的（換一天再答對就記住了）→ 新題目 → 其他錯題 → 已記住的
  const prioritized = list => {
    const wrong = shuffle(list.filter(isWrong));
    const second = shuffle(list.filter(q => { const h = hist[q.id]; return h && h.last && h.days < 2 && h.rday !== td; }));
    const fresh = shuffle(list.filter(q => !hist[q.id]));
    const rest = shuffle(list.filter(q => { const h = hist[q.id]; return h && h.last && !(h.days < 2 && h.rday !== td); }));
    const out = [], seen = new Set();
    [wrong.slice(0, 3), second, fresh, wrong.slice(3), rest].forEach(g => g.forEach(q => { if (!seen.has(q.id)) { seen.add(q.id); out.push(q); } }));
    return out.slice(0, n);
  };
  // 素養島：照優先順序挑題組，一次拿整組，湊到大約一回合的題數
  const byGroups = list => {
    const ranked = shuffle(list).sort((a, b) => rank(a) - rank(b));
    const out = [], taken = new Set();
    for (const q of ranked) {
      if (out.length >= n) break;
      if (taken.has(q.passage)) continue;
      taken.add(q.passage);
      out.push(...list.filter(x => x.passage === q.passage).slice(0, 6));
    }
    return out.slice(0, 30);
  };
  const rank = q => { const h = hist[q.id]; return !h ? 1 : !h.last ? 0 : (h.days < 2 && h.rday !== td) ? 1 : 2; };
  let picked;
  const lit = /^素養(?::(.+))?$/.exec(String(island || ''));
  if (SUBJECTS.includes(island)) {
    picked = prioritized((await poolFor(ctx, jsonp(cls.units, []))).filter(q => q.subject === island && !q.passage));
  } else if (String(island || '').startsWith('單元:')) {
    // 單課練習：只出這一個已教單元的一般題（素養題組在素養島）
    const key = String(island).slice(3);
    if (!jsonp(cls.units, []).includes(key)) fail('這個單元還沒開放。');
    picked = prioritized((await poolFor(ctx, [key])).filter(q => !q.passage));
  } else if (lit) {
    if (lit[1] && !SUBJECTS.includes(lit[1])) fail('沒有這座島。');
    picked = byGroups((await poolFor(ctx, jsonp(cls.units, []))).filter(q => q.passage && (!lit[1] || q.subject === lit[1])));
  } else if (island === '錯題') {
    picked = shuffle((await poolFor(ctx, jsonp(cls.units, []))).filter(isWrong)).slice(0, n);
  } else if (island === '綜合') {
    const pool = (await poolFor(ctx, jsonp(cls.units, []))).filter(q => !q.passage);
    const by = SUBJECTS.map(sj => shuffle(pool.filter(q => q.subject === sj)));
    picked = [];
    for (let i = 0; picked.length < n && by.some(b => b.length); i = (i + 1) % by.length) if (by[i].length) picked.push(by[i].shift());
  } else if (island === '段考') {
    const ex = exam(cls);
    if (!ex) fail('目前沒有要準備的考試。');
    picked = prioritized(await poolFor(ctx, ex.units));
  } else fail('沒有這座島。');
  if (!picked.length) fail(island === '錯題' ? '錯題本是空的，太厲害了！' : lit ? '這裡還沒有開放的素養題組，等老師上完課再來。' : '這座島還沒有開放的題目，等老師上完課再來。');
  return groupPassages(lit ? picked : shuffle(picked)).map(publicQ);
};

/** 同一段情境的題目排在一起（題組），其他題目順序不變 */
function groupPassages(list) {
  const out = [], done = new Set();
  list.forEach(q => {
    if (done.has(q.id)) return;
    if (!q.passage) { out.push(q); done.add(q.id); return; }
    list.filter(x => x.passage === q.passage).forEach(x => { out.push(x); done.add(x.id); });
  });
  return out;
}

API.submitRound = async (ctx, cred, island, responses) => {
  const { cls, s } = await auth(ctx, cred, false);
  const set = await ctx.settings();
  const list = (Array.isArray(responses) ? responses : []).slice(0, 30);
  const ids = [...new Set(list.map(r => str(r && r.id, 40)))];
  if (!ids.length) fail('沒有收到作答。');
  const qmap = {};
  { const b = await bank(ctx); ids.forEach(id => { const q = b.byId.get(id); if (q) qmap[id] = q; }); }
  const ts = stampNow(), day = today();
  const stmts = [], missed = new Set(), seen = new Set();
  const before = await history(ctx, cls.code, s.seat, s.total);
  const taughtPool = await poolFor(ctx, jsonp(cls.units, []));
  const reviewUnits = new Set(unitLevels(taughtPool, before).filter(u => u.review).map(u => u.key));
  const wrongBefore = taughtPool.filter(q => before[q.id] && !before[q.id].last).length;
  const longAgo = new Date(Date.now() + 8 * 3600e3 - 21 * 864e5).toISOString().slice(0, 10);
  const gotOk = {};
  const passageOk = {};   // 每一段情境：答了幾題、對了幾題（題組全對用）
  const fc = await focusConf(ctx), exNow = exam(cls), exUnits = new Set(exNow ? exNow.units : []);
  const boost = island === '段考' && exNow && exNow.days <= EXAM_BOOST_DAYS;
  let outside = 0, retryOk = 0;
  let correct = 0, coinW = 0, rescued = 0, passageRight = 0, reviewDone = false, longmem = 0;
  list.forEach(r => {
    const q = qmap[str(r && r.id, 40)];
    if (!q || seen.has(q.id)) return;  // 同一題只算一次
    seen.add(q.id);
    // 答錯會先給提示、再答一次：first 是第一次的答案。精熟、錯題、過關都照第一次算；第二次答對拿一半金幣
    const firstAns = r.first != null && r.first !== '' ? r.first : r.answer;
    const ok = grade(q, firstAns), ok2 = !ok && r.first != null && r.first !== '' && grade(q, r.answer);
    gotOk[q.id] = ok;
    let w = fc.subjects.includes(q.subject) ? (q.passage ? FOCUS_LIT_RATE : FOCUS_RATE) : 1;
    if (boost) w = Math.max(w, FOCUS_RATE);
    if ((ok || ok2) && exNow && !exUnits.has(q.unit_key)) { w *= fc.outside; outside++; }  // 考試範圍外：金幣打折
    if (ok2) { coinW += w * 0.5; retryOk++; }
    if (ok) {
      correct++;
      coinW += w;
      if (before[q.id] && !before[q.id].last) rescued++;   // 之前答錯，這次答對
      if (q.passage) passageRight++;
      if (reviewUnits.has(q.unit_key)) reviewDone = true;
      if (before[q.id] && before[q.id].rday && before[q.id].rday <= longAgo) longmem++;  // 隔 21 天以上再答仍答對
    } else concepts(q.concept).forEach(c => missed.add(c));
    if (q.passage) { const g = passageOk[q.passage] = passageOk[q.passage] || { n: 0, ok: 0 }; g.n++; if (ok) g.ok++; }
    stmts.push(ctx.stmt('INSERT INTO logs (ts, day, class_code, seat, qid, subject, unit, answer, ok) VALUES (?,?,?,?,?,?,?,?,?)', ts, day, cls.code, s.seat, q.id, q.subject, q.unit, str(firstAns, 100), ok ? 1 : 0));
    // 答對：如果今天還沒答對過這題，答對的日子數 +1
    stmts.push(ctx.stmt(`INSERT INTO progress (class_code, seat, qid, last_ok, right_days, last_right_day, last_day) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(class_code, seat, qid) DO UPDATE SET last_ok = excluded.last_ok, last_day = excluded.last_day,
        right_days = right_days + CASE WHEN excluded.last_ok = 1 AND last_right_day <> excluded.last_day THEN 1 ELSE 0 END,
        last_right_day = CASE WHEN excluded.last_ok = 1 THEN excluded.last_day ELSE last_right_day END`,
      cls.code, s.seat, q.id, ok ? 1 : 0, ok ? 1 : 0, ok ? day : '', day));
    // 全班每題的累計對錯（老師後台的弱點統計用；測試帳號不算）
    if (!s.is_test) stmts.push(ctx.stmt(`INSERT INTO qstats (class_code, qid, right, total) VALUES (?,?,?,1)
      ON CONFLICT(class_code, qid) DO UPDATE SET right = right + excluded.right, total = total + 1`, cls.code, q.id, ok ? 1 : 0));
  });
  const total = seen.size;
  if (total) stmts.push(ctx.stmt('INSERT OR IGNORE INTO play_days (class_code, seat, day) VALUES (?,?,?)', cls.code, s.seat, day));
  if (!total) fail('沒有收到作答。');
  const passed = correct / total >= (num(set.pass_ratio) || 0.7);
  let gotStamp = false;
  const fIsland = focusOf(island, fc.subjects);
  const stampNeedFocus = passed && s.last_day !== day && fc.stamp && !fIsland;  // 過關了，但不是主力島，不蓋章
  if (passed && s.last_day !== day && !stampNeedFocus) {
    gotStamp = true;
    s.streak = s.last_day === yesterday() ? s.streak + 1 : 1;
    s.last_day = day;
    s.stamps += 1;
    s.stamp_days = JSON.stringify(jsonp(s.stamp_days, []).concat(day).slice(-62));
  }
  // 每日任務：主力科目各過關 1 回合
  let fDone = focusToday(s), focusBonus = 0;
  if (passed && fIsland && !fDone.includes(fIsland)) fDone = fDone.concat(fIsland);
  if (fc.subjects.length && fc.subjects.every(x => fDone.includes(x)) && !fDone.includes('★')) { fDone = fDone.concat('★'); focusBonus = FOCUS_BONUS; s.focus_days = (s.focus_days || 0) + 1; }
  s.focus_day = day; s.focus_done = JSON.stringify(fDone);
  const coins = Math.round(coinW) + focusBonus;
  s.coins += coins; s.earned += coins;
  const starsToday = s.star_day === day ? s.star_today : 0;
  const gotStar = passed && (starsToday < STAR_DAILY_MAX || !!s.is_test);
  if (gotStar) s.stars += 1;
  s.star_day = day; s.star_today = starsToday + (gotStar ? 1 : 0);
  s.total += total; s.right_count += correct;
  const comeback = passed && s.last_fail_day === day;
  s.rescued += rescued; s.passage_right += passageRight; s.longmem += longmem;
  if (!passed) s.last_fail_day = day;
  stmts.push(ctx.stmt('UPDATE students SET rescued = rescued + ?, passage_right = passage_right + ?, longmem = longmem + ?, last_fail_day = ?, stamp_days = ? WHERE class_code = ? AND seat = ?',
    rescued, passageRight, longmem, s.last_fail_day, s.stamp_days || '[]', cls.code, s.seat));
  stmts.push(ctx.stmt(`UPDATE students SET coins = coins + ?, earned = earned + ?, stars = stars + ?, stamps = stamps + ?,
      streak = ?, last_day = ?, total = total + ?, right_count = right_count + ?, star_day = ?, star_today = ?, focus_day = ?, focus_done = ?, focus_days = ? WHERE class_code = ? AND seat = ?`,
    coins, coins, gotStar ? 1 : 0, gotStamp ? 1 : 0, s.streak, s.last_day, total, correct, s.star_day, s.star_today, s.focus_day, s.focus_done, s.focus_days || 0, cls.code, s.seat));
  await ctx.db.batch(stmts);
  // 記憶體裡的作答紀錄也照資料庫的規則更新，後面算等級時不用再讀一次
  Object.entries(gotOk).forEach(([id, ok]) => {
    const h = before[id];
    if (!h) { before[id] = { last: ok, days: ok ? 1 : 0, rday: ok ? day : '', day }; return; }
    if (ok && h.rday !== day) h.days++;
    if (ok) h.rday = day;
    h.last = ok; h.day = day;
  });
  hcachePut(cls.code + '|' + s.seat, s.total, before);  // 交卷後的版本（total 已經加上這回合）
  const st = await state(ctx, cls, s);
  // 新精熟的單元：記錄下來（徽章與加點用），每個單元只記第一次
  const had = new Set((await ctx.all('SELECT unit_key FROM mastery WHERE class_code = ? AND seat = ?', cls.code, s.seat)).map(r => r.unit_key));
  const newly = st.units.filter(u => u.rawLevel === MASTER && !had.has(u.key));
  if (newly.length) await ctx.batch(newly.map(u => ctx.stmt('INSERT OR IGNORE INTO mastery (class_code, seat, unit_key, day) VALUES (?,?,?,?)', cls.code, s.seat, u.key, day)));
  // 一步一腳印：新精熟的單元裡，曾經有答錯過的題目
  let climb = false;
  if (newly.length) {
    const b = await bank(ctx), keys = new Set(newly.map(u => u.key));
    climb = (await ctx.all('SELECT DISTINCT qid FROM logs WHERE class_code = ? AND seat = ? AND ok = 0', cls.code, s.seat))
      .some(r => { const q = b.byId.get(r.qid); return q && keys.has(q.unit_key); });
  }
  // 觀念突破：這回合答過的觀念裡，有一個以前錯過 3 次以上、最近 5 題都答對
  let concept = false;
  const cs = [...new Set([...seen].map(id => qmap[id].concept).filter(Boolean))].slice(0, 10);
  const recent = cs.length ? await ctx.all('SELECT qid, ok FROM logs WHERE class_code = ? AND seat = ? ORDER BY id DESC LIMIT 800', cls.code, s.seat) : [];
  const bk = await bank(ctx);
  for (const c of cs) {
    const rows = recent.filter(r => { const q = bk.byId.get(r.qid); return q && q.concept === c; }).slice(0, 200);
    if (rows.length >= 8 && rows.slice(0, 5).every(r => r.ok === 1) && rows.slice(5).filter(r => r.ok === 0).length >= 3) { concept = true; break; }
  }
  const nb = await awardBadges(ctx, cls, s, st, {
    comeback, review: reviewDone, perfect: total >= 8 && correct === total, exam: island === '段考' && passed,
    climb, concept, clearwrong: wrongBefore >= 5 && st.wrong === 0,
    groupall: Object.values(passageOk).some(g => g.n >= 3 && g.ok === g.n),
    lighthouse: island === '綜合' && total >= 5 && correct === total
  });
  st.badges = st.badges.concat(nb.map(b => b.id));
  return { correct, total, passed, coins, retryOk, focusBonus, focusCoins: Math.round(coinW) - correct, outside, outsideRate: fc.outside, examBoost: !!boost, stampNeedFocus, focusSubjects: fc.subjects, star: gotStar, starFull: passed && !gotStar, starMax: STAR_DAILY_MAX, stamp: gotStamp, missed: [...missed].slice(0, 4), mastered: newly.map(u => u.subject + '・' + u.unit),
    badges: nb.map(b => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc })), state: st };
};

API.buyItem = async (ctx, cred, id) => {
  const { cls, s } = await auth(ctx, cred, false);
  const item = SHOP[id];
  if (!item) fail('商店沒有這個東西。');
  const have = owned(s);
  if (have.includes(id)) fail('你已經有這個了。');
  if (item.hidden && !onShelf(ctx, id, shopDay(ctx))) fail('這是還沒揭曉的神秘角色，上架那天才能買喔！');
  if (item.mine) fail('旗子要先畫好、通過老師審核。');
  if (s.is_test) return testGet(ctx, cls, s, [id]);
  if (item.stars && s.stars < item.stars) fail('還要再拿 ' + (item.stars - s.stars) + ' 顆星星，才能買「' + item.name + '」。');
  if (item.badges) {
    const n = await badgeCount(ctx, cls, s);
    if (n < item.badges) fail('還要再拿 ' + (item.badges - n) + ' 個徽章，才能買「' + item.name + '」。');
  }
  await checkNeed(ctx, cls, s, item, item.name);
  const info = priceInfo(ctx, id, shopDay(ctx)), price = info.price;
  if (info.soon) fail('「' + item.name + '」' + Number(info.soon.slice(5, 7)) + '/' + Number(info.soon.slice(8)) + ' 早上 8 點才上架喔！');
  if (!onShelf(ctx, id, shopDay(ctx))) fail('「' + item.name + '」現在沒有上架。');
  const q = saleQuota(ctx, s), counts = q.active && price > 0;
  if (counts && q.left <= 0) fail(SALE_FULL);
  if (s.coins < price) fail('金幣還不夠，再去島上挑戰吧！');
  have.push(id);
  const o = outfit(s); o[item.slot] = id;
  if (counts) { s.sale_key = q.key; s.sale_buys = q.used + 1; }
  const r = await ctx.run('UPDATE students SET coins = coins - ?, owned = ?, outfit = ?, sale_key = ?, sale_buys = ? WHERE class_code = ? AND seat = ? AND coins >= ?',
    price, JSON.stringify(have), JSON.stringify(o), s.sale_key || '', s.sale_buys || 0, cls.code, s.seat, price);
  if (!r.meta.changes) fail('金幣還不夠，再去島上挑戰吧！');
  s.coins -= price; s.owned = JSON.stringify(have); s.outfit = JSON.stringify(o);
  return shopState(ctx, cls, s);
};

/** 測試帳號（老師試玩）：金幣、星星、徽章都不限，還沒上架的新品也能直接拿來穿 */
async function testGet(ctx, cls, s, ids) {
  const have = owned(s), o = outfit(s);
  ids.forEach(x => { if (!have.includes(x)) have.push(x); o[SHOP[x].slot] = x; });
  s.owned = JSON.stringify(have); s.outfit = JSON.stringify(o);
  await ctx.run('UPDATE students SET owned = ?, outfit = ? WHERE class_code = ? AND seat = ?', s.owned, s.outfit, cls.code, s.seat);
  return shopState(ctx, cls, s);
}

API.buySet = async (ctx, cred, id) => {
  const { cls, s } = await auth(ctx, cred, false);
  const set = SETS[id];
  if (!set) fail('商店沒有這個套裝。');
  const key = SHOP[set.key], have = owned(s);
  const missing = set.items.filter(x => !have.includes(x) && SHOP[x].price > 0);
  if (!missing.length) fail('這個套裝你已經全部都有了。');
  if (s.is_test) return testGet(ctx, cls, s, set.items);
  if (s.stars < key.stars) fail('還要再拿 ' + (key.stars - s.stars) + ' 顆星星，才能買「' + set.name + '」。');
  const n = await badgeCount(ctx, cls, s);
  if (n < key.badges) fail('還要再拿 ' + (key.badges - n) + ' 個徽章，才能買「' + set.name + '」。');
  await checkNeed(ctx, cls, s, key, set.name);
  if (!set.items.every(x => onShelf(ctx, x, shopDay(ctx)))) fail('「' + set.name + '」現在沒有上架。');
  const price = setPrice(ctx, set, have);
  const q = saleQuota(ctx, s);
  if (q.active && q.left <= 0) fail(SALE_FULL);
  if (s.coins < price) fail('金幣還不夠，再去島上挑戰吧！');
  have.push(...missing);
  const o = outfit(s); set.items.forEach(x => { o[SHOP[x].slot] = x; });
  if (q.active) { s.sale_key = q.key; s.sale_buys = q.used + 1; }  // 套裝算 1 樣
  const r = await ctx.run('UPDATE students SET coins = coins - ?, owned = ?, outfit = ?, sale_key = ?, sale_buys = ? WHERE class_code = ? AND seat = ? AND coins >= ?',
    price, JSON.stringify(have), JSON.stringify(o), s.sale_key || '', s.sale_buys || 0, cls.code, s.seat, price);
  if (!r.meta.changes) fail('金幣還不夠，再去島上挑戰吧！');
  s.coins -= price; s.owned = JSON.stringify(have); s.outfit = JSON.stringify(o);
  return shopState(ctx, cls, s);
};

API.setOutfit = async (ctx, cred, want) => {
  const { cls, s } = await auth(ctx, cred, false);
  const have = owned(s), o = outfit(s);
  Object.keys(DEFAULT_OUTFIT).forEach(slot => {
    const id = want && want[slot];
    if (id && SHOP[id] && SHOP[id].slot === slot && (SHOP[id].price === 0 || have.includes(id)) && !(SHOP[id].mine && !s.flag)) o[slot] = id;
  });
  s.outfit = JSON.stringify(o);
  await ctx.run('UPDATE students SET outfit = ? WHERE class_code = ? AND seat = ?', s.outfit, cls.code, s.seat);
  return shopState(ctx, cls, s);
};

/** 衣櫃動作（買、穿、脫、存檔、旗子）回傳的精簡狀態：只讀徽章和旗子，不重讀學習紀錄，省 D1 讀取 */
async function shopState(ctx, cls, s) {
  const [brows, custom, flag] = await Promise.all([
    ctx.all('SELECT badge FROM badges WHERE class_code = ? AND seat = ?', cls.code, s.seat), customBadges(ctx), flagState(ctx, cls, s)]);
  const q = saleQuota(ctx, s);
  return { coins: s.coins, earned: s.earned, stars: s.stars, badges: brows.map(r => r.badge), badgeList: BADGES.concat(custom),
    owned: owned(s), outfit: outfit(s), shop: shopView(ctx, owned(s), !!s.is_test), sets: setsView(ctx, !!s.is_test), shopInfo: shopInfo(ctx),
    isTest: !!s.is_test, saleLeft: q.active ? q.left : null, saleLimit: SALE_LIMIT, flag, customColor: s.custom_color || '',
    saves: { slots: s.save_slots || 0, list: jsonp(s.saved, []), prices: SAVE_PRICES } };
}

/* ---------- 自訂顏色、造型存檔 ---------- */

API.setCustomColor = async (ctx, cred, hex) => {
  const { cls, s } = await auth(ctx, cred, false);
  if (!s.is_test && !owned(s).includes('color_custom')) fail('要先買「自訂顏色」。');
  hex = String(hex || '').toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) fail('顏色格式不對。');
  const o = outfit(s); o.color = 'color_custom';
  s.custom_color = hex; s.outfit = JSON.stringify(o);
  await ctx.run('UPDATE students SET custom_color = ?, outfit = ? WHERE class_code = ? AND seat = ?', hex, s.outfit, cls.code, s.seat);
  return shopState(ctx, cls, s);
};

/** 造型存檔：第 1、2、3 格解鎖價格（照順序解鎖，不算進特價限買） */
const SAVE_PRICES = [50, 150, 300];
API.unlockSave = async (ctx, cred) => {
  const { cls, s } = await auth(ctx, cred, false);
  const n = s.save_slots || 0;
  if (n >= SAVE_PRICES.length) fail('存檔已經全部解鎖了。');
  const price = s.is_test ? 0 : SAVE_PRICES[n];
  if (s.coins < price) fail('金幣還不夠，再去島上挑戰吧！');
  const r = await ctx.run('UPDATE students SET coins = coins - ?, save_slots = ? WHERE class_code = ? AND seat = ? AND coins >= ? AND save_slots = ?', price, n + 1, cls.code, s.seat, price, n);
  if (!r.meta.changes) fail('金幣還不夠，再去島上挑戰吧！');
  s.coins -= price; s.save_slots = n + 1;
  return shopState(ctx, cls, s);
};
API.saveOutfit = async (ctx, cred, idx) => {
  const { cls, s } = await auth(ctx, cred, false);
  idx = Math.floor(num(idx));
  if (idx < 0 || idx >= (s.save_slots || 0)) fail('這一格還沒解鎖。');
  const list = jsonp(s.saved, []); list[idx] = outfit(s);
  for (let i = 0; i < list.length; i++) if (!list[i]) list[i] = null;
  s.saved = JSON.stringify(list);
  await ctx.run('UPDATE students SET saved = ? WHERE class_code = ? AND seat = ?', s.saved, cls.code, s.seat);
  return shopState(ctx, cls, s);
};
API.loadOutfit = async (ctx, cred, idx) => {
  const { cls, s } = await auth(ctx, cred, false);
  const one = jsonp(s.saved, [])[Math.floor(num(idx))];
  if (!one) fail('這一格還沒有存造型。');
  return API.setOutfit(ctx, cred, one);
};

/* ---------- 自己畫的旗子 ---------- */
const FLAG_PRICE = 50;
/** 學生的旗子：通過的、審核中的、最近一次還沒看過的審核結果 */
async function flagState(ctx, cls, s) {
  const rows = await ctx.all("SELECT * FROM flags WHERE class_code = ? AND seat = ? AND (status = 'pending' OR seen = 0) ORDER BY id DESC LIMIT 3", cls.code, s.seat);
  const p = rows.find(r => r.status === 'pending'), d = rows.find(r => r.status !== 'pending');
  return { grid: s.flag || '', price: FLAG_PRICE, pending: p ? p.grid : '', result: d ? { id: d.id, status: d.status, note: d.note } : null };
}
API.submitFlag = async (ctx, cred, grid) => {
  const { cls, s } = await auth(ctx, cred, false);
  grid = String(grid || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(grid)) fail('旗子的格子不對，請重新畫。');
  if (!s.is_test && s.coins < FLAG_PRICE) fail('要有 ' + FLAG_PRICE + ' 金幣才能送審（通過時才會扣）。');
  const p = await ctx.first("SELECT id FROM flags WHERE class_code = ? AND seat = ? AND status = 'pending'", cls.code, s.seat);
  if (p) await ctx.run('UPDATE flags SET grid = ?, ts = ? WHERE id = ?', grid, stampNow(), p.id);
  else await ctx.run('INSERT INTO flags (ts, class_code, seat, grid) VALUES (?,?,?,?)', stampNow(), cls.code, s.seat, grid);
  return shopState(ctx, cls, s);
};
API.tFlags = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  return ctx.all(`SELECT f.id, f.ts, f.seat, f.grid, f.status, f.note, st.nick, st.coins FROM flags f LEFT JOIN students st ON st.class_code = f.class_code AND st.seat = f.seat
    WHERE f.class_code = ? ORDER BY f.status = 'pending' DESC, f.id DESC LIMIT 40`, cls.code);
};
/** 審核旗子：通過時才扣金幣、換上旗子；不通過不扣錢 */
API.tReviewFlag = async (ctx, pw, id, ok, note) => {
  await checkPw(ctx, pw);
  const f = await ctx.first("SELECT * FROM flags WHERE id = ? AND status = 'pending'", Math.floor(num(id)));
  if (!f) fail('找不到待審核的旗子。');
  if (!ok) {
    await ctx.run("UPDATE flags SET status = 'rejected', note = ?, decided = ? WHERE id = ?", str(note, 100), stampNow(), f.id);
    return true;
  }
  const st = await ctx.first('SELECT coins, is_test, outfit FROM students WHERE class_code = ? AND seat = ?', f.class_code, f.seat);
  const price = st.is_test ? 0 : FLAG_PRICE;
  if (st.coins < price) fail('這位同學現在金幣不到 ' + FLAG_PRICE + '，先不要通過，或請他存夠再審。');
  const o = jsonp(st.outfit, {}); o.flag = 'flag_mine';
  await ctx.db.batch([
    ctx.stmt('UPDATE students SET coins = coins - ?, flag = ?, outfit = ? WHERE class_code = ? AND seat = ? AND coins >= ?', price, f.grid, JSON.stringify(o), f.class_code, f.seat, price),
    ctx.stmt("UPDATE flags SET status = 'approved', note = ?, decided = ? WHERE id = ?", str(note, 100), stampNow(), f.id)
  ]);
  return true;
};

/* ---------- 衣櫃許願池 ----------
 * 學生每週可以許 1 個願望：寫字，或畫圖＋說明。老師審核後公開給全班（匿名）集氣，
 * 也可以標「實現了」或「沒有採用」。Claude 可以用匯入鑰匙讀願望清單（xWishes）幫忙設計。 */
const monday = () => { const d = new Date(today() + 'T00:00:00Z'); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
const wishOut = (w, mine) => ({ id: w.id, ts: w.ts, week: mine ? w.week : '', text: w.text, image: w.image ? '/img/' + w.image : '', status: w.status, note: mine ? w.note : '', votes: w.votes });
API.makeWish = async (ctx, cred, text, dataUrl) => {
  const { cls, s } = await auth(ctx, cred, false);
  text = str(text, 50);
  if (text.length < 2) fail('寫一下你想要什麼造型吧！');
  const wk = monday();
  if (await ctx.first('SELECT id FROM wishes WHERE class_code = ? AND seat = ? AND week = ?', cls.code, s.seat, wk)) fail('這週已經許過願了，下週一再來！');
  let img = '';
  if (dataUrl) {
    const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m || m[2].length > 4e5) fail('圖畫得太大了，請重畫。');
    img = 'W' + Date.now().toString(36).toUpperCase() + [...crypto.getRandomValues(new Uint8Array(8))].map(b => (b % 36).toString(36)).join('').toUpperCase();
    await ctx.run('INSERT INTO images (id, mime, data, created) VALUES (?,?,?,?)', img, m[1], m[2], today());
  }
  await ctx.run('INSERT INTO wishes (ts, week, class_code, seat, text, image) VALUES (?,?,?,?,?,?)', stampNow(), wk, cls.code, s.seat, text, img);
  return true;
};
API.wishes = async (ctx, cred) => {
  const { cls, s } = await auth(ctx, cred, false);
  const [mine, pub, voted] = await Promise.all([
    ctx.all('SELECT * FROM wishes WHERE class_code = ? AND seat = ? ORDER BY id DESC LIMIT 10', cls.code, s.seat),
    ctx.all("SELECT * FROM wishes WHERE class_code = ? AND status IN ('public', 'done') ORDER BY status = 'done', votes DESC, id DESC LIMIT 40", cls.code),
    ctx.all('SELECT wish_id FROM wish_votes WHERE class_code = ? AND seat = ?', cls.code, s.seat)
  ]);
  const v = new Set(voted.map(r => r.wish_id));
  return { mine: mine.map(w => wishOut(w, true)), pub: pub.map(w => Object.assign(wishOut(w), { voted: v.has(w.id), own: w.seat === s.seat })), canWish: !mine.some(w => w.week === monday()) };
};
API.voteWish = async (ctx, cred, id) => {
  const { cls, s } = await auth(ctx, cred, false);
  id = Math.floor(num(id));
  const w = await ctx.first("SELECT id FROM wishes WHERE id = ? AND class_code = ? AND status = 'public'", id, cls.code);
  if (!w) fail('找不到這個願望。');
  const had = await ctx.first('SELECT wish_id FROM wish_votes WHERE wish_id = ? AND class_code = ? AND seat = ?', id, cls.code, s.seat);
  await ctx.db.batch(had
    ? [ctx.stmt('DELETE FROM wish_votes WHERE wish_id = ? AND class_code = ? AND seat = ?', id, cls.code, s.seat), ctx.stmt('UPDATE wishes SET votes = MAX(0, votes - 1) WHERE id = ?', id)]
    : [ctx.stmt('INSERT INTO wish_votes (wish_id, class_code, seat) VALUES (?,?,?)', id, cls.code, s.seat), ctx.stmt('UPDATE wishes SET votes = votes + 1 WHERE id = ?', id)]);
  return !had;
};
API.tWishes = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const rows = await ctx.all(`SELECT w.*, st.nick FROM wishes w LEFT JOIN students st ON st.class_code = w.class_code AND st.seat = w.seat
    WHERE w.class_code = ? ORDER BY w.status = 'pending' DESC, w.votes DESC, w.id DESC LIMIT 100`, cls.code);
  return rows.map(w => Object.assign(wishOut(w, true), { seat: w.seat, nick: w.nick || '' }));
};
/** 老師處理願望：public 公開集氣、done 實現了、declined 沒有採用（只有許願的同學看得到原因） */
API.tWish = async (ctx, pw, id, status, note) => {
  await checkPw(ctx, pw);
  if (!['public', 'done', 'declined'].includes(status)) fail('請選處理方式。');
  const r = await ctx.run('UPDATE wishes SET status = ?, note = ? WHERE id = ?', status, str(note, 100), Math.floor(num(id)));
  if (!r.meta.changes) fail('找不到這個願望。');
  return true;
};
/** Claude 用：公開和實現的願望（依集氣數），幫老師設計新造型 */
API.xWishes = async ctx => {
  checkImport(ctx);
  const rows = await ctx.all("SELECT * FROM wishes WHERE status IN ('pending', 'public') ORDER BY votes DESC, id DESC LIMIT 60");
  return rows.map(w => ({ id: w.id, class: w.class_code, text: w.text, image: w.image ? '/img/' + w.image : '', status: w.status, votes: w.votes }));
};

/* ---------- 老師 ---------- */

/** 每一科的課本版本（沒設定的科目沿用班級的 version） */
function subjectVersions(c) {
  const m = jsonp(c.versions, {}), out = {};
  SUBJECTS.forEach(sj => out[sj] = str(m[sj], 20) || c.version || COMMON);
  return out;
}
function cleanVersions(v) {
  const out = {};
  SUBJECTS.forEach(sj => { const x = str(v && v[sj], 20); if (x) out[sj] = x; });
  return JSON.stringify(out);
}

function classOut(c) {
  return { code: c.code, name: c.name, grade: c.grade, sem: c.sem, version: c.version || COMMON, versions: subjectVersions(c), status: c.status, units: jsonp(c.units, []), exam: { name: c.exam_name, date: c.exam_date, units: jsonp(c.exam_units, []) }, notice: c.notice || '', noticeUntil: c.notice_until || '', mission: c.mission || '' };
}

async function versions(ctx) {
  const v = new Set([COMMON, '南一', '康軒', '翰林']);
  (await bank(ctx)).rows.forEach(q => q.version && v.add(q.version));
  (await ctx.all('SELECT version FROM classes')).forEach(r => r.version && v.add(r.version));
  (await ctx.all('SELECT versions FROM classes')).forEach(r => Object.values(jsonp(r.versions, {})).forEach(x => x && v.add(x)));
  return [...v];
}

/** 單元清單：老師管理的單元表 ＋ 題庫裡有題目的單元，照課本順序排列 */
async function unitCatalog(ctx) {
  const [b, own] = await Promise.all([bank(ctx), ctx.all('SELECT * FROM units')]);
  const rows = [...b.byUnit.entries()].map(([key, qs]) => { const q = qs[0]; return { key, version: q.version, grade: q.grade, sem: q.sem, subject: q.subject, unit: q.unit, enabled: qs.filter(x => x.enabled === 1).length }; });
  const m = {};
  own.forEach(u => m[u.unit_key] = { key: u.unit_key, version: u.version, grade: u.grade, sem: u.sem, subject: u.subject, unit: u.unit, count: 0, sort: u.sort, own: true });
  rows.forEach(r => {
    if (m[r.key]) m[r.key].count = r.enabled || 0;
    else if (r.enabled > 0) m[r.key] = { key: r.key, version: r.version, grade: r.grade, sem: r.sem, subject: r.subject, unit: r.unit, count: r.enabled, sort: 100000, own: false };
  });
  return Object.values(m).sort((a, b) => a.version.localeCompare(b.version) || a.grade - b.grade || a.sem.localeCompare(b.sem)
    || SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject) || a.sort - b.sort || a.unit.localeCompare(b.unit, 'zh-Hant'));
}

API.tLogin = async (ctx, pw) => {
  await checkPw(ctx, pw);
  const classes = (await ctx.all('SELECT code, name, grade, sem, version, versions, status FROM classes ORDER BY created, code'))
    .map(c => ({ code: c.code, name: c.name, grade: c.grade, sem: c.sem, version: c.version, versions: subjectVersions(c), status: c.status }));
  return { classes, versions: await versions(ctx) };
};

/** 只要單元清單（切換到教學進度、題庫管理時用），比整個後台資料輕很多 */
API.tUnits = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  return { cls: classOut(cls), units: await unitCatalog(ctx), versions: await versions(ctx) };
};

API.tDashboard = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const rt = await rate(ctx);
  const week = new Date(Date.now() + 8 * 3600e3 - 6 * 864e5).toISOString().slice(0, 10);
  const [students, days, stats, wrongRows, mPend, b] = await Promise.all([
    ctx.all('SELECT * FROM students WHERE class_code = ? ORDER BY seat', cls.code),
    ctx.all('SELECT seat, COUNT(*) AS n FROM play_days WHERE class_code = ? AND day >= ? GROUP BY seat', cls.code, week),
    ctx.all('SELECT qid, right, total FROM qstats WHERE class_code = ?', cls.code),
    ctx.all('SELECT seat, qid FROM progress WHERE class_code = ? AND last_ok = 0', cls.code),
    ctx.all('SELECT seat, COUNT(*) AS n FROM mastery WHERE class_code = ? AND redeemed = 0 GROUP BY seat', cls.code),
    bank(ctx)
  ]);
  // 全班統計（不含測試帳號）：用每題累計的 qstats 加上記憶體裡的題庫算，不用掃全部作答紀錄
  const uAgg = {}, cAgg = {}, qs = [];
  stats.forEach(r => {
    const q = b.byId.get(r.qid); if (!q) return;
    const uk = q.subject + '｜' + q.unit, u = uAgg[uk] = uAgg[uk] || { subject: q.subject, unit: q.unit, right: 0, total: 0 };
    u.right += r.right; u.total += r.total;
    if (q.concept) { const ck = q.subject + '｜' + q.concept, c = cAgg[ck] = cAgg[ck] || { subject: q.subject, concept: q.concept, right: 0, total: 0 }; c.right += r.right; c.total += r.total; }
    if (r.total >= 3 && r.total > r.right) qs.push({ id: q.id, text: q.text, subject: q.subject, unit: q.unit, answer: q.answer, wrong: r.total - r.right, total: r.total });
  });
  qs.sort((x, y) => y.wrong / y.total - x.wrong / x.total); qs.splice(8);
  const units = Object.values(uAgg), cs = Object.values(cAgg);
  const wrongNow = wrongRows.map(r => { const q = b.byId.get(r.qid); return q && { seat: r.seat, subject: q.subject, concept: q.concept }; }).filter(Boolean);
  const mMap = {}; mPend.forEach(r => mMap[r.seat] = r.n);
  const bMap = {}, cMap = Object.fromEntries((await customBadges(ctx)).map(b => [b.id, b]));
  (await ctx.all('SELECT seat, badge FROM badges WHERE class_code = ?', cls.code)).forEach(r => (bMap[r.seat] = bMap[r.seat] || []).push(r.badge));
  const dayMap = {}; days.forEach(r => dayMap[r.seat] = r.n);
  const testSeats = new Set(students.filter(s => s.is_test).map(s => s.seat));
  const weakBy = {}, wrongCount = {}, cPeople = {};
  wrongNow.forEach(r => {
    wrongCount[r.seat] = (wrongCount[r.seat] || 0) + 1;
    concepts(r.concept).forEach(c => {
      const w = weakBy[r.seat] = weakBy[r.seat] || {}; w[c] = (w[c] || 0) + 1;
      const k = r.subject + '｜' + c; if (!testSeats.has(r.seat)) (cPeople[k] = cPeople[k] || new Set()).add(r.seat);
    });
  });
  const cStat = {};
  cs.forEach(r => concepts(r.concept).forEach(c => {
    const k = r.subject + '｜' + c;
    const x = cStat[k] = cStat[k] || { concept: c, subject: r.subject, right: 0, total: 0 };
    x.right += r.right; x.total += r.total;
  }));
  return {
    cls: classOut(cls), rate: rt, badgeTotal: BADGES.length + Object.keys(cMap).length,
    openReports: (await ctx.first("SELECT COUNT(DISTINCT qid) AS n FROM reports WHERE status = 'open'")).n,
    openAsks: (await ctx.first("SELECT COUNT(*) AS n FROM asks WHERE class_code = ? AND status = 'open'", cls.code)).n,
    pendingFlags: (await ctx.first("SELECT COUNT(*) AS n FROM flags WHERE class_code = ? AND status = 'pending'", cls.code)).n,
    pendingWishes: (await ctx.first("SELECT COUNT(*) AS n FROM wishes WHERE class_code = ? AND status = 'pending'", cls.code)).n,
    students: students.map(s => {
      const stamps = s.stamps - s.stamps_redeemed, coinsPending = s.earned - s.coins_redeemed;
      const coinPts = rt.coinsPerPoint > 0 ? Math.floor(coinsPending / rt.coinsPerPoint) : 0;
      const w = weakBy[s.seat] || {};
      return {
        seat: s.seat, nick: s.nick, isTest: !!s.is_test, hasPin: !!s.pin, coins: s.coins, earned: s.earned, stars: s.stars,
        stamps, coinsPending, masteryPending: mMap[s.seat] || 0, points: s.is_test ? 0 : stamps * rt.perStamp + coinPts + (mMap[s.seat] || 0) * rt.perMastery,
        streak: liveStreak(s), last: s.last_day, weekDays: dayMap[s.seat] || 0,
        total: s.total, right: s.right_count, wrongNow: wrongCount[s.seat] || 0,
        weak: Object.keys(w).sort((a, b) => w[b] - w[a]).slice(0, 2),
        locked: s.locked_until > Date.now(),
        badges: (bMap[s.seat] || []).map(id => BADGE_MAP[id] || cMap[id]).filter(Boolean).map(b => b.icon + ' ' + b.name)
      };
    }),
    units: await unitCatalog(ctx),
    versions: await versions(ctx),
    weakUnits: units.filter(u => u.total >= 5).map(u => ({ unit: u.subject + '｜' + u.unit, right: u.right, total: u.total }))
      .sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 6),
    weakConcepts: Object.keys(cStat).map(k => Object.assign(cStat[k], { people: [...(cPeople[k] || [])].sort((a, b) => a - b) }))
      .filter(c => c.total >= 3).sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 8),
    hardQs: qs
  };
};

API.tSaveClass = async (ctx, pw, code, data) => {
  await checkPw(ctx, pw);
  const c = await findClass(ctx, code);
  data = data || {};
  if (Array.isArray(data.units)) c.units = JSON.stringify(data.units.map(x => str(x, 200)).slice(0, 500));
  if (data.name) c.name = str(data.name, 40);
  if (data.grade) c.grade = Math.min(6, Math.max(1, Math.floor(num(data.grade)))) || c.grade;
  if (data.sem === '上' || data.sem === '下') c.sem = data.sem;
  if (data.version) c.version = str(data.version, 20);
  if (data.versions) c.versions = cleanVersions(data.versions);
  if (data.status === '進行中' || data.status === '封存') c.status = data.status;
  if (data.exam) {
    const d = str(data.exam.date, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('考試日期格式不對。');
    c.exam_name = str(data.exam.name, 20);
    c.exam_date = d;
    c.exam_units = JSON.stringify((data.exam.units || []).map(x => str(x, 200)).slice(0, 500));
  }
  if (data.notice !== undefined) c.notice = str(data.notice, 120);
  if (data.noticeUntil !== undefined) { const d = str(data.noticeUntil, 10); c.notice_until = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; }
  if (data.mission !== undefined) c.mission = SUBJECTS.concat(['素養', '錯題', '綜合', '段考']).includes(data.mission) ? data.mission : '';
  await ctx.run('UPDATE classes SET name=?, grade=?, sem=?, version=?, versions=?, units=?, status=?, exam_name=?, exam_date=?, exam_units=?, notice=?, notice_until=?, mission=? WHERE code=?',
    c.name, c.grade, c.sem, c.version, c.versions || '{}', c.units, c.status, c.exam_name, c.exam_date, c.exam_units, c.notice || '', c.notice_until || '', c.mission || '', c.code);
  return classOut(c);
};

API.tCreateClass = async (ctx, pw, data) => {
  await checkPw(ctx, pw);
  data = data || {};
  const code = up(data.code);
  if (!/^[A-Z0-9]{3,12}$/.test(code)) fail('班級代碼請用 3 到 12 個英文字母或數字，例如 115A601。');
  if (await ctx.first('SELECT code FROM classes WHERE code = ?', code)) fail('這個班級代碼已經有人用了。');
  const count = Math.min(Math.max(Math.floor(num(data.count)), 1), 60);
  const stmts = [ctx.stmt('INSERT INTO classes (code, name, grade, sem, version, versions, created) VALUES (?,?,?,?,?,?,?)',
    code, str(data.name, 40) || code, Math.min(6, Math.max(1, Math.floor(num(data.grade)) || 6)), data.sem === '下' ? '下' : '上', str(data.version, 20) || COMMON, cleanVersions(data.versions), today())];
  for (let i = 1; i <= count; i++) stmts.push(ctx.stmt('INSERT INTO students (class_code, seat) VALUES (?, ?)', code, i));
  // 測試帳號放在最後一號的下一個整十：26 號 → 30 號、36 號 → 40 號
  if (data.testSeat !== false) stmts.push(ctx.stmt("INSERT INTO students (class_code, seat, nick, is_test) VALUES (?, ?, '老師測試', 1)", code, testSeatAfter(count)));
  await ctx.batch(stmts);
  return API.tLogin(ctx, pw);
};

function testSeatAfter(last) { return Math.floor(last / 10) * 10 + 10; }

API.tAddStudents = async (ctx, pw, code, count) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const r = await ctx.first('SELECT MAX(seat) AS m FROM students WHERE class_code = ? AND is_test = 0', cls.code);
  const start = (r && r.m || 0) + 1, n = Math.min(Math.max(Math.floor(num(count)), 1), 20);
  const taken = await ctx.first('SELECT seat FROM students WHERE class_code = ? AND seat BETWEEN ? AND ? ORDER BY seat LIMIT 1', cls.code, start, start + n - 1);
  if (taken) fail(taken.seat + ' 號目前是測試帳號。請先在那一列按「改回學生」，或把人數改少一點。');
  const stmts = [];
  for (let i = 0; i < n; i++) stmts.push(ctx.stmt('INSERT INTO students (class_code, seat) VALUES (?, ?)', cls.code, start + i));
  await ctx.batch(stmts);
  return n;
};

API.tResetPin = async (ctx, pw, code, seat) => {
  await checkPw(ctx, pw);
  const r = await ctx.run("UPDATE students SET pin = '', fails = 0, locked_until = 0 WHERE class_code = ? AND seat = ?", up(code), Math.floor(num(seat)));
  if (!r.meta.changes) fail('找不到這位學生。');
  return true;
};

/** 測試帳號：老師自己試玩用，不算進全班統計、精熟人數、排行榜和加點 */
API.tSetTest = async (ctx, pw, code, seat, on) => {
  await checkPw(ctx, pw);
  const r = await ctx.run('UPDATE students SET is_test = ? WHERE class_code = ? AND seat = ?', on ? 1 : 0, up(code), Math.floor(num(seat)));
  if (!r.meta.changes) fail('找不到這位學生。');
  // 全班統計重算一次，讓這位學生以前的作答也照新的設定算進或排除
  await ctx.db.batch([
    ctx.stmt('DELETE FROM qstats WHERE class_code = ?', up(code)),
    ctx.stmt(`INSERT INTO qstats (class_code, qid, right, total) SELECT l.class_code, l.qid, SUM(l.ok), COUNT(*) FROM logs l
      WHERE l.class_code = ? AND NOT EXISTS (SELECT 1 FROM students t WHERE t.class_code = l.class_code AND t.seat = l.seat AND t.is_test = 1)
      GROUP BY l.class_code, l.qid`, up(code))
  ]);
  return true;
};

API.tSetNick = async (ctx, pw, code, seat, nick) => {
  await checkPw(ctx, pw);
  await ctx.run('UPDATE students SET nick = ? WHERE class_code = ? AND seat = ?', str(nick, 10), up(code), Math.floor(num(seat)));
  return true;
};

/** 日常加點：把還沒兌換的印章與累積金幣換成點數。金幣餘額不扣，學生照樣可以在商店用 */
API.tRedeem = async (ctx, pw, code, seats, note) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const rt = await rate(ctx);
  const want = new Set((seats || []).map(x => Math.floor(num(x))));
  const ts = stampNow();
  const out = [], stmts = [];
  const mMap = {};
  (await ctx.all('SELECT seat, COUNT(*) AS n FROM mastery WHERE class_code = ? AND redeemed = 0 GROUP BY seat', cls.code)).forEach(r => mMap[r.seat] = r.n);
  (await ctx.all('SELECT * FROM students WHERE class_code = ?', cls.code)).forEach(s => {
    if (!want.has(s.seat) || s.is_test) return;
    const stamps = s.stamps - s.stamps_redeemed, coinsPending = s.earned - s.coins_redeemed;
    const coinPts = rt.coinsPerPoint > 0 ? Math.floor(coinsPending / rt.coinsPerPoint) : 0;
    const masteryN = rt.perMastery > 0 ? (mMap[s.seat] || 0) : 0;
    const coinsUsed = coinPts * rt.coinsPerPoint, stampPts = stamps * rt.perStamp, points = stampPts + coinPts + masteryN * rt.perMastery;
    if (points <= 0) return;
    const usedStamps = stampPts > 0 ? stamps : 0;
    stmts.push(ctx.stmt('UPDATE students SET stamps_redeemed = stamps_redeemed + ?, coins_redeemed = coins_redeemed + ? WHERE class_code = ? AND seat = ?', usedStamps, coinsUsed, cls.code, s.seat));
    if (masteryN) stmts.push(ctx.stmt('UPDATE mastery SET redeemed = 1 WHERE class_code = ? AND seat = ? AND redeemed = 0', cls.code, s.seat));
    stmts.push(ctx.stmt('INSERT INTO points_log (ts, class_code, seat, nick, stamps, coins, points, note, mastery) VALUES (?,?,?,?,?,?,?,?,?)', ts, cls.code, s.seat, s.nick, usedStamps, coinsUsed, points, str(note, 60), masteryN));
    out.push({ seat: s.seat, nick: s.nick, stamps: usedStamps, coins: coinsUsed, mastery: masteryN, points });
  });
  if (stmts.length) await ctx.db.batch(stmts);
  return out;
};

API.tPointsLog = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  return ctx.all('SELECT ts, seat, nick, stamps, coins, mastery, points, note FROM points_log WHERE class_code = ? ORDER BY id DESC LIMIT 2000', up(code));
};

/** 精熟總覽：每位學生在每個已教單元的等級 */
API.tMastery = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const pool = await poolFor(ctx, jsonp(cls.units, []));
  const [students, prog] = await Promise.all([
    ctx.all('SELECT seat, nick, is_test FROM students WHERE class_code = ? ORDER BY is_test, seat', cls.code),
    ctx.all('SELECT seat, qid, last_ok, right_days, last_right_day, last_day FROM progress WHERE class_code = ?', cls.code)
  ]);
  const hadBy = {}; (await ctx.all('SELECT seat, unit_key FROM mastery WHERE class_code = ?', cls.code)).forEach(r => (hadBy[r.seat] = hadBy[r.seat] || new Set()).add(r.unit_key));
  const hBy = {};
  prog.forEach(r => (hBy[r.seat] = hBy[r.seat] || {})[r.qid] = { last: r.last_ok === 1, days: r.right_days, rday: r.last_right_day, day: r.last_day });
  const base = unitLevels(pool, {});
  const sortOf = {}; (await unitCatalog(ctx)).forEach(u => sortOf[u.key] = u.sort);
  const order = base.map(u => u.key).sort((a, b) => {
    const A = base.find(u => u.key === a), B = base.find(u => u.key === b);
    return SUBJECTS.indexOf(A.subject) - SUBJECTS.indexOf(B.subject) || (sortOf[a] ?? 1e6) - (sortOf[b] ?? 1e6) || a.localeCompare(b);
  });
  const rows = students.map(st => {
    const lv = {}, review = [];
    finishLevels(unitLevels(pool, hBy[st.seat] || {}), hadBy[st.seat]).forEach(u => { lv[u.key] = u.level; if (u.review) review.push(u.key); });
    return { seat: st.seat, nick: st.nick, isTest: !!st.is_test, levels: lv, review };
  });
  return {
    units: order.map(k => { const u = base.find(x => x.key === k); return { key: k, subject: u.subject, unit: u.unit, total: u.total, mastered: rows.filter(r => !r.isTest && r.levels[k] === MASTER).length }; }),
    students: rows
  };
};

/* ---------- 單元管理（課程進度表） ---------- */

const UNIT_COLS = ['版本', '年級', '學期', '科目', '單元'];

/** 匯入單元表：可以貼上課本目錄（Tab 或逗號分隔）。版本空白時依班級各科的版本 */
API.tImportUnits = async (ctx, pw, text, defaultVersion) => {
  await checkPw(ctx, pw);
  return importUnits(ctx, text, defaultVersion);
};
async function importUnits(ctx, text, defaultVersion) {
  const lines = parseTable(String(text || '').replace(/^\uFEFF/, ''));
  if (lines.length > 1001) fail('一次最多 1000 個單元。');
  let cols = UNIT_COLS, start = 0;
  if (lines.length && lines[0].some(c => String(c).trim() === '單元')) { cols = lines[0].map(c => String(c).trim()); start = 1; }
  else if (lines.length && lines[0].length === 4) cols = ['年級', '學期', '科目', '單元'];  // 沒有版本欄
  const existing = new Set((await ctx.all('SELECT unit_key FROM units')).map(r => r.unit_key));
  const maxSort = {};
  (await ctx.all('SELECT version, grade, sem, subject, MAX(sort) AS m FROM units GROUP BY version, grade, sem, subject')).forEach(r => maxSort[[r.version, r.grade, r.sem, r.subject].join('|')] = r.m);
  const stmts = [], errors = [];
  let added = 0, skipped = 0;
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].join('').trim()) continue;
    const v = {};
    cols.forEach((c, j) => v[c] = String(lines[i][j] == null ? '' : lines[i][j]).trim());
    v['學期'] = (v['學期'] || '').replace('學期', '');
    v['版本'] = v['版本'] || (defaultVersion && typeof defaultVersion === 'object' ? str(defaultVersion[v['科目']], 20) : str(defaultVersion, 20)) || COMMON;
    if (!/^[1-6]$/.test(v['年級'])) { errors.push('第 ' + (i + 1) + ' 行：年級要填 1 到 6'); continue; }
    if (!/^[上下]$/.test(v['學期'])) { errors.push('第 ' + (i + 1) + ' 行：學期要填「上」或「下」'); continue; }
    if (!SUBJECTS.includes(v['科目'])) { errors.push('第 ' + (i + 1) + ' 行：科目要是 ' + SUBJECTS.join('、') + ' 其中之一'); continue; }
    if (!v['單元']) { errors.push('第 ' + (i + 1) + ' 行：缺少單元名稱'); continue; }
    const u = { version: str(v['版本'], 20), grade: Number(v['年級']), sem: v['學期'], subject: v['科目'], unit: str(v['單元'], 60) };
    const key = unitKey(u);
    if (existing.has(key)) { skipped++; continue; }
    existing.add(key);
    const g = [u.version, u.grade, u.sem, u.subject].join('|');
    maxSort[g] = (maxSort[g] || 0) + 1;
    stmts.push(ctx.stmt('INSERT INTO units (unit_key, version, grade, sem, subject, unit, sort, created) VALUES (?,?,?,?,?,?,?,?)', key, u.version, u.grade, u.sem, u.subject, u.unit, maxSort[g], today()));
    added++;
  }
  await ctx.batch(stmts);
  return { added, skipped, errors: errors.slice(0, 30) };
};

/** 單元改名：題目、班級進度、段考範圍、延伸冒險、精熟紀錄都跟著改 */
API.tRenameUnit = async (ctx, pw, key, name) => {
  await checkPw(ctx, pw);
  key = str(key, 200); name = str(name, 60);
  if (!name) fail('請輸入新的單元名稱。');
  const p = key.split('｜');
  if (p.length !== 4) fail('找不到這個單元。');
  const m = /^(\d)(上|下)$/.exec(p[1]);
  if (!m) fail('找不到這個單元。');
  const nk = [p[0], p[1], p[2], name].join('｜');
  if (nk === key) return true;
  if (await ctx.first('SELECT unit_key FROM units WHERE unit_key = ? UNION SELECT unit_key FROM questions WHERE unit_key = ? LIMIT 1', nk, nk)) fail('已經有同名的單元了。');
  const own = await ctx.first('SELECT * FROM units WHERE unit_key = ?', key);
  const stmts = [
    ctx.stmt('UPDATE questions SET unit = ?, unit_key = ? WHERE unit_key = ?', name, nk, key),
    ctx.stmt('UPDATE links SET unit_key = ? WHERE unit_key = ?', nk, key),
    ctx.stmt('UPDATE mastery SET unit_key = ? WHERE unit_key = ?', nk, key)
  ];
  if (own) stmts.push(ctx.stmt('UPDATE units SET unit = ?, unit_key = ? WHERE unit_key = ?', name, nk, key));
  else stmts.push(ctx.stmt('INSERT INTO units (unit_key, version, grade, sem, subject, unit, sort, created) VALUES (?,?,?,?,?,?,?,?)', nk, p[0], Number(m[1]), m[2], p[2], name, 100000, today()));
  (await ctx.all('SELECT code, units, exam_units FROM classes')).forEach(c => {
    const u = jsonp(c.units, []), e = jsonp(c.exam_units, []);
    if (u.includes(key) || e.includes(key)) stmts.push(ctx.stmt('UPDATE classes SET units = ?, exam_units = ? WHERE code = ?',
      JSON.stringify(u.map(x => x === key ? nk : x)), JSON.stringify(e.map(x => x === key ? nk : x)), c.code));
  });
  await ctx.batch(stmts);
  return true;
};

/** 刪除單元：只能刪沒有題目的單元 */
API.tDeleteUnit = async (ctx, pw, key) => {
  await checkPw(ctx, pw);
  key = str(key, 200);
  const n = (await ctx.first('SELECT COUNT(*) AS n FROM questions WHERE unit_key = ?', key)).n;
  if (n) fail('這個單元還有 ' + n + ' 題，請先到「題庫管理」刪除或停用這些題目。');
  const stmts = [
    ctx.stmt('DELETE FROM units WHERE unit_key = ?', key),
    ctx.stmt('DELETE FROM link_done WHERE link_id IN (SELECT id FROM links WHERE unit_key = ?)', key),
    ctx.stmt('DELETE FROM links WHERE unit_key = ?', key)
  ];
  (await ctx.all('SELECT code, units, exam_units FROM classes')).forEach(c => {
    const u = jsonp(c.units, []), e = jsonp(c.exam_units, []);
    if (u.includes(key) || e.includes(key)) stmts.push(ctx.stmt('UPDATE classes SET units = ?, exam_units = ? WHERE code = ?',
      JSON.stringify(u.filter(x => x !== key)), JSON.stringify(e.filter(x => x !== key)), c.code));
  });
  await ctx.batch(stmts);
  return true;
};

/* ---------- 題庫 ---------- */

// 「情境」放在最後一欄，舊的 14 欄格式照樣可以匯入
const IMPORT_COLS = ['版本', '年級', '學期', '科目', '單元', '觀念', '題型', '題目', '選項A', '選項B', '選項C', '選項D', '答案', '解析', '情境'];

function validateQ(v) {
  if (!/^[1-6]$/.test(v['年級'])) return '年級要填 1 到 6';
  if (!/^[上下]$/.test(v['學期'])) return '學期要填「上」或「下」';
  if (!SUBJECTS.includes(v['科目'])) return '科目要是 ' + SUBJECTS.join('、') + ' 其中之一';
  if (!v['單元']) return '缺少單元名稱';
  if (!v['題目']) return '缺少題目';
  if (!['選擇', '是非', '填空'].includes(v['題型'])) return '題型要是 選擇、是非、填空';
  if (!v['答案']) return '缺少答案';
  if (v['題型'] === '選擇' && (!v['選項A'] || !v['選項B'])) return '選擇題至少要有選項A和選項B';
  if (v['題型'] === '選擇' && !/^[A-Da-d]$/.test(v['答案'])) return '選擇題答案請填 A、B、C 或 D';
  if (v['題型'] === '選擇' && !v['選項' + v['答案'].toUpperCase()]) return '答案指到空白的選項';
  if (v['題型'] === '是非' && tf(v['答案']) === null) return '是非題答案請填 O 或 X';
  return '';
}

function qFromRow(v, id, source) {
  const q = {
    id, version: str(v['版本'], 20) || COMMON, grade: Number(v['年級']), sem: v['學期'], subject: v['科目'], unit: str(v['單元'], 60),
    concept: str(v['觀念'], 60), type: v['題型'], text: str(v['題目'], 1000),
    a: str(v['選項A'], 300), b: str(v['選項B'], 300), c: str(v['選項C'], 300), d: str(v['選項D'], 300),
    answer: v['題型'] === '選擇' ? v['答案'].toUpperCase() : v['題型'] === '是非' ? tf(v['答案']) : str(v['答案'], 300),
    explain: str(v['解析'], 500), passage: str(v['情境'], 3000), image: '', source: str(source, 10) || '老師'
  };
  q.unit_key = unitKey(q);
  return q;
}
const Q_COLS = ['id', 'version', 'grade', 'sem', 'subject', 'unit', 'unit_key', 'concept', 'type', 'text', 'a', 'b', 'c', 'd', 'answer', 'explain', 'passage', 'image', 'source', 'enabled', 'created'];

function parseTable(text) {
  const sep = text.indexOf('\t') >= 0 ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

API.tImport = async (ctx, pw, text, source, defaultVersion) => {
  await checkPw(ctx, pw);
  return importQuestions(ctx, text, source, defaultVersion);
};
async function importQuestions(ctx, text, source, defaultVersion) {
  const lines = parseTable(String(text || '').replace(/^﻿/, ''));
  if (lines.length > 2001) fail('一次最多匯入 2000 題，請分批貼上。');
  let cols = IMPORT_COLS, start = 0;
  if (lines.length && lines[0].some(c => String(c).trim() === '題目')) { cols = lines[0].map(c => String(c).trim()); start = 1; }
  const errors = [], stmts = [];
  const base = Date.now().toString(36).toUpperCase();
  // 同一個單元裡題目文字完全一樣的，視為重複，不再匯入（避免同一份檔案匯入兩次）
  const seen = new Set((await bank(ctx)).rows.map(r => r.unit_key + '\u0001' + r.text + '\u0001' + r.passage));
  let added = 0, skipped = 0;
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].join('').trim()) continue;
    const v = {};
    cols.forEach((c, j) => v[c] = String(lines[i][j] == null ? '' : lines[i][j]).trim());
    // 版本空白時：可以給單一版本，或給 {科目: 版本} 依科目決定
    v['版本'] = v['版本'] || (defaultVersion && typeof defaultVersion === 'object' ? str(defaultVersion[v['科目']], 20) : str(defaultVersion, 20)) || COMMON;
    v['學期'] = (v['學期'] || '').replace('學期', '');
    const msg = validateQ(v);
    if (msg) { errors.push('第 ' + (i + 1) + ' 行：' + msg); continue; }
    const q = qFromRow(v, 'Q' + base + String(added).padStart(4, '0'), source);
    const sig = q.unit_key + '\u0001' + q.text + '\u0001' + q.passage;
    if (seen.has(sig)) { skipped++; continue; }
    seen.add(sig);
    q.enabled = 1; q.created = today();
    stmts.push(ctx.stmt(`INSERT INTO questions (${Q_COLS.join(',')}) VALUES (${Q_COLS.map(() => '?').join(',')})`, ...Q_COLS.map(k => q[k])));
    added++;
  }
  await ctx.batch(stmts);
  return { added, skipped, errors: errors.slice(0, 30), moreErrors: Math.max(0, errors.length - 30) };
};

/* ---------- 匯入專用入口（給 Claude 對話直接匯入用） ----------
 * 要帶 X-Import-Token 標頭，值必須等於 Cloudflare 上的 IMPORT_TOKEN。
 * 只能「看班級版本與單元清單」和「新增單元、新增題目」，看不到學生資料，也不能刪改任何東西。
 */
function checkImport(ctx) {
  const real = String(ctx.env.IMPORT_TOKEN || '');
  if (real.length < 20) fail('網站還沒有設定匯入鑰匙（IMPORT_TOKEN）。');
  if (!safeEqual(ctx.importToken, real)) fail('匯入鑰匙不正確。');
}
API.xClasses = async ctx => {
  checkImport(ctx);
  return (await ctx.all("SELECT code, name, grade, sem, version, versions, status FROM classes WHERE status = '進行中' ORDER BY created"))
    .map(c => ({ code: c.code, name: c.name, grade: c.grade, sem: c.sem, versions: subjectVersions(c) }));
};
API.xUnits = async ctx => { checkImport(ctx); return unitCatalog(ctx); };
API.xImportUnits = async (ctx, text, versions) => { checkImport(ctx); return importUnits(ctx, text, versions); };
API.xAddLinks = async (ctx, list) => {
  checkImport(ctx);
  const out = [];
  for (const d of (Array.isArray(list) ? list : []).slice(0, 50)) {
    const unitKey = str(d.unitKey, 200), title = str(d.title, 40), note = str(d.note, 80);
    if (!unitKey || !(await linkUnitOk(ctx, unitKey))) { out.push({ title, err: '找不到單元' }); continue; }
    if (!title) { out.push({ err: '沒有名稱' }); continue; }
    const url = cleanUrl(d.url);
    if (await ctx.first('SELECT id FROM links WHERE unit_key = ? AND url = ?', unitKey, url)) { out.push({ title, skip: '已經有了' }); continue; }
    await ctx.run('INSERT INTO links (id, unit_key, title, url, note, star, created) VALUES (?,?,?,?,?,?,?)', 'L' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(), unitKey, title, url, note, d.star ? 1 : 0, stampNow());
    out.push({ title, ok: true });
  }
  return out;
};
API.xImportQuestions = async (ctx, text, versions) => { checkImport(ctx); return importQuestions(ctx, text, 'AI', versions); };

API.tQuestions = async (ctx, pw, filter) => {
  await checkPw(ctx, pw);
  filter = filter || {};
  const where = [], p = [];
  if (filter.version) { where.push('version = ?'); p.push(str(filter.version, 20)); }
  if (filter.subject) { where.push('subject = ?'); p.push(str(filter.subject, 10)); }
  if (filter.unitKey) { where.push('unit_key = ?'); p.push(str(filter.unitKey, 200)); }
  if (filter.q) { where.push("(text LIKE ? OR unit LIKE ? OR concept LIKE ? OR passage LIKE ?)"); const k = '%' + str(filter.q, 40) + '%'; p.push(k, k, k, k); }
  const rows = await ctx.all(`SELECT * FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY version, grade, sem, subject, unit, id LIMIT 301`, ...p);
  return { rows: rows.slice(0, 300), more: rows.length > 300 };
};

API.tSaveQuestion = async (ctx, pw, data) => {
  await checkPw(ctx, pw);
  const v = {};
  IMPORT_COLS.forEach(c => v[c] = str(data && data[c], 1000));
  const msg = validateQ(v);
  if (msg) fail(msg);
  const id = str(data.id, 40);
  const q = qFromRow(v, id || ('Q' + Date.now().toString(36).toUpperCase()), data.source || '老師');
  q.image = String(data.image || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (q.image && !(await ctx.first('SELECT id FROM images WHERE id = ?', q.image))) fail('找不到這張圖片，請重新上傳。');
  if (id) {
    const r = await ctx.run(`UPDATE questions SET version=?, grade=?, sem=?, subject=?, unit=?, unit_key=?, concept=?, type=?, text=?, a=?, b=?, c=?, d=?, answer=?, explain=?, passage=?, image=? WHERE id=?`,
      q.version, q.grade, q.sem, q.subject, q.unit, q.unit_key, q.concept, q.type, q.text, q.a, q.b, q.c, q.d, q.answer, q.explain, q.passage, q.image, id);
    if (!r.meta.changes) fail('找不到這一題。');
  } else {
    q.enabled = 1; q.created = today();
    await ctx.run(`INSERT INTO questions (${Q_COLS.join(',')}) VALUES (${Q_COLS.map(() => '?').join(',')})`, ...Q_COLS.map(k => q[k]));
  }
  return ctx.first('SELECT * FROM questions WHERE id = ?', q.id);
};

API.tSetEnabled = async (ctx, pw, ids, enabled) => {
  await checkPw(ctx, pw);
  const list = (ids || []).map(x => str(x, 40)).slice(0, 1000);
  await ctx.run('UPDATE questions SET enabled = ? WHERE id IN (SELECT value FROM json_each(?))', enabled ? 1 : 0, JSON.stringify(list));
  return list.length;
};

/** 刪除題目。作答過的題目會保留紀錄，改成停用，以免弄亂統計 */
API.tDeleteQuestions = async (ctx, pw, ids) => {
  await checkPw(ctx, pw);
  const list = JSON.stringify((ids || []).map(x => str(x, 40)).slice(0, 1000));
  const used = await ctx.all('SELECT DISTINCT qid FROM logs WHERE qid IN (SELECT value FROM json_each(?))', list);
  const usedSet = JSON.stringify(used.map(r => r.qid));
  await ctx.db.batch([
    ctx.stmt('UPDATE questions SET enabled = 0 WHERE id IN (SELECT value FROM json_each(?))', usedSet),
    ctx.stmt('DELETE FROM questions WHERE id IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT value FROM json_each(?))', list, usedSet)
  ]);
  return { deleted: JSON.parse(list).length - used.length, disabled: used.length };
};

/* ---------- 圖片 ---------- */

/** 上傳題目圖片：前端先縮小成 JPEG/PNG，再以 data URL 傳上來 */
API.tUploadImage = async (ctx, pw, dataUrl) => {
  await checkPw(ctx, pw);
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) fail('圖片格式不對，請用 JPG 或 PNG。');
  if (m[2].length > 1.4e6) fail('圖片太大了，請換小一點的圖。');
  const id = 'I' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  await ctx.run('INSERT INTO images (id, mime, data, created) VALUES (?,?,?,?)', id, m[1], m[2], today());
  return { id, url: '/img/' + id };
};

/** 「關於與版權」用的署名（不用登入） */
/** 學生看完「這次更新了什麼」：記下版本，下次登入就不會再跳出 */
API.seenNews = async (ctx, cred, ver) => {
  const { cls, s } = await auth(ctx, cred, false);
  await ctx.run('UPDATE students SET news_seen = ? WHERE class_code = ? AND seat = ?', str(ver, 30), cls.code, s.seat);
  return true;
};

API.about = async ctx => ({ credit: (await ctx.settings()).credit || '' });

/* ---------- 學生回報題目 ---------- */

const REPORT_REASONS = ['答案好像錯了', '題目看不懂', '選項有問題', '圖片看不清楚', '其他'];

API.reportQuestion = async (ctx, cred, qid, reason, note, answer) => {
  const { cls, s } = await auth(ctx, cred, false);
  qid = str(qid, 40);
  if (!REPORT_REASONS.includes(reason)) fail('請選一個原因。');
  if (!(await ctx.first('SELECT id FROM questions WHERE id = ?', qid))) fail('找不到這一題。');
  const dup = await ctx.first("SELECT id FROM reports WHERE class_code = ? AND seat = ? AND qid = ? AND status = 'open'", cls.code, s.seat, qid);
  if (dup) return { already: true };
  await ctx.run('INSERT INTO reports (ts, class_code, seat, qid, reason, note, answer, seen) VALUES (?,?,?,?,?,?,?,0)', stampNow(), cls.code, s.seat, qid, reason, str(note, 100), str(answer, 100));
  return { ok: true };
};

/* ---------- 學生提問 ----------
 * 學生上傳截圖＋文字提問（每天最多 ASK_DAILY 題）。老師回覆時選：
 *   answered 一般回答、bug 找到系統問題（加金幣、星星，算進「系統偵探」徽章）、warn 只提醒、junk 亂提問（扣金幣，不會扣成負數）。
 * 回覆可以公開給全班（匿名、不給截圖），全班下次登入會看到；也可以只給提問的同學。
 * Claude 可以用匯入鑰匙讀待處理的提問、寫回覆草稿；草稿要老師在後台按送出，學生才看得到。 */
const ASK_DAILY = 3, ASK_KINDS = ['answered', 'bug', 'warn', 'junk'];
/** 亂提問、亂回報預設扣的金幣（會增加老師的工作量，所以扣重一點；老師處理時可以改） */
const JUNK_PENALTY = 30;
const askOut = a => ({ id: a.id, ts: a.ts, text: a.text, status: a.status, reply: a.reply, reward: a.reward, public: !!a.public });

/** 登入時要跳出的：全班公開的新回覆、自己提問的新回覆 */
async function askNews(ctx, cls, s) {
  const [pub, mine, reps] = await Promise.all([
    ctx.all("SELECT id, text, reply FROM asks WHERE class_code = ? AND public = 1 AND id > ? AND status <> 'open' ORDER BY id LIMIT 10", cls.code, s.asks_seen || 0),
    ctx.all("SELECT * FROM asks WHERE class_code = ? AND seat = ? AND status <> 'open' AND seen = 0 ORDER BY id LIMIT 10", cls.code, s.seat),
    ctx.all("SELECT r.id, r.result, r.reply, r.penalty, q.text FROM reports r LEFT JOIN questions q ON q.id = r.qid WHERE r.class_code = ? AND r.seat = ? AND r.status <> 'open' AND r.seen = 0 ORDER BY r.id LIMIT 10", cls.code, s.seat)
  ]);
  return { pub: pub.map(a => ({ id: a.id, text: a.text, reply: a.reply })), mine: mine.map(askOut), reps: reps.map(r => ({ text: r.text || '', result: r.result, reply: r.reply, penalty: r.penalty })) };  // 旗子的審核結果在 flag.result
}

/** 回覆滿 30 天的提問：刪掉截圖（文字和回覆留著）。老師打開提問分頁、學生送出提問時順便清 */
async function cleanShots(ctx) {
  const before = new Date(Date.now() + 8 * 3600e3 - 30 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const old = await ctx.all("SELECT id, image FROM asks WHERE image <> '' AND status <> 'open' AND replied <> '' AND replied < ? LIMIT 50", before);
  if (!old.length) return;
  await ctx.db.batch(old.flatMap(a => [ctx.stmt('DELETE FROM images WHERE id = ?', a.image), ctx.stmt("UPDATE asks SET image = '' WHERE id = ?", a.id)]));
}

API.askQuestion = async (ctx, cred, text, dataUrl) => {
  const { cls, s } = await auth(ctx, cred, false);
  text = str(text, 200);
  if (text.length < 4) fail('請把問題寫清楚一點（至少 4 個字）。');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) fail('請附上一張截圖。');
  if (m[2].length > 1.4e6) fail('截圖太大了，請重新截一張。');
  const day = today();
  const n = (await ctx.first('SELECT COUNT(*) AS n FROM asks WHERE class_code = ? AND seat = ? AND day = ?', cls.code, s.seat, day)).n;
  if (n >= ASK_DAILY) fail('一天最多問 ' + ASK_DAILY + ' 題，明天再問吧！');
  const rnd = [...crypto.getRandomValues(new Uint8Array(10))].map(b => (b % 36).toString(36)).join('').toUpperCase();
  const img = 'S' + Date.now().toString(36).toUpperCase() + rnd;
  await ctx.db.batch([
    ctx.stmt('INSERT INTO images (id, mime, data, created) VALUES (?,?,?,?)', img, m[1], m[2], day),
    ctx.stmt('INSERT INTO asks (ts, day, class_code, seat, text, image) VALUES (?,?,?,?,?,?)', stampNow(), day, cls.code, s.seat, text, img)
  ]);
  await cleanShots(ctx);
  return { left: ASK_DAILY - n - 1 };
};

/** 學生的提問頁：自己的提問（含截圖）、全班公開的回覆 */
API.myAsks = async (ctx, cred) => {
  const { cls, s } = await auth(ctx, cred, false);
  const [mine, pub, n, reps] = await Promise.all([
    ctx.all('SELECT * FROM asks WHERE class_code = ? AND seat = ? ORDER BY id DESC LIMIT 20', cls.code, s.seat),
    ctx.all("SELECT * FROM asks WHERE class_code = ? AND public = 1 AND status <> 'open' ORDER BY id DESC LIMIT 30", cls.code),
    ctx.first('SELECT COUNT(*) AS n FROM asks WHERE class_code = ? AND seat = ? AND day = ?', cls.code, s.seat, today()),
    ctx.all('SELECT r.ts, r.reason, r.answer, r.status, r.result, r.reply, r.penalty, q.text FROM reports r LEFT JOIN questions q ON q.id = r.qid WHERE r.class_code = ? AND r.seat = ? ORDER BY r.id DESC LIMIT 20', cls.code, s.seat)
  ]);
  return { reps: reps.map(r => ({ ts: r.ts, reason: r.reason, answer: r.answer, open: r.status === 'open', result: r.result || (r.status === 'confirmed' ? 'confirmed' : r.status === 'done' ? 'ok' : ''), reply: r.reply, penalty: r.penalty, text: r.text || '' })), mine: mine.map(a => Object.assign(askOut(a), { image: a.image ? '/img/' + a.image : '' })), pub: pub.map(askOut), left: Math.max(0, ASK_DAILY - n.n), daily: ASK_DAILY };
};

/** 學生看過回覆：公開的記到最大 id，自己的標成看過 */
API.seenAsks = async (ctx, cred, pubMax) => {
  const { cls, s } = await auth(ctx, cred, false);
  await ctx.db.batch([
    ctx.stmt('UPDATE students SET asks_seen = MAX(asks_seen, ?) WHERE class_code = ? AND seat = ?', Math.floor(num(pubMax)), cls.code, s.seat),
    ctx.stmt("UPDATE asks SET seen = 1 WHERE class_code = ? AND seat = ? AND status <> 'open' AND seen = 0", cls.code, s.seat),
    ctx.stmt("UPDATE flags SET seen = 1 WHERE class_code = ? AND seat = ? AND status <> 'pending' AND seen = 0", cls.code, s.seat),
    ctx.stmt("UPDATE reports SET seen = 1 WHERE class_code = ? AND seat = ? AND status <> 'open' AND seen = 0", cls.code, s.seat)
  ]);
  return true;
};

API.tAsks = async (ctx, pw, code, all) => {
  await checkPw(ctx, pw);
  await cleanShots(ctx);
  const cls = await findClass(ctx, code);
  const rows = await ctx.all(`SELECT a.*, st.nick FROM asks a LEFT JOIN students st ON st.class_code = a.class_code AND st.seat = a.seat
    WHERE a.class_code = ? ${all ? '' : "AND a.status = 'open'"} ORDER BY a.status = 'open' DESC, a.id DESC LIMIT 100`, cls.code);
  return rows.map(a => Object.assign(askOut(a), { seat: a.seat, nick: a.nick || '', image: a.image ? '/img/' + a.image : '', draft: a.draft, draftKind: a.draft_kind, draftNote: a.draft_note, replied: a.replied }));
};

/** 老師處理提問：kind 處理結果、reply 回覆、pub 公開給全班、coins／stars 加（bug）或扣（junk）的數量 */
API.tAnswerAsk = async (ctx, pw, id, data) => {
  await checkPw(ctx, pw);
  data = data || {};
  const a = await ctx.first('SELECT * FROM asks WHERE id = ?', Math.floor(num(id)));
  if (!a) fail('找不到這則提問。');
  if (a.status !== 'open') fail('這則提問已經處理過了。');
  const kind = ASK_KINDS.includes(data.kind) ? data.kind : 'answered';
  const reply = str(data.reply, 300);
  if (!reply) fail('請寫回覆。');
  const coins = Math.max(0, Math.min(200, Math.floor(num(data.coins)))), stars = Math.max(0, Math.min(10, Math.floor(num(data.stars))));
  const stmts = [];
  let reward = '';
  if (kind === 'bug') {
    reward = [coins ? '+' + coins + ' 金幣' : '', stars ? '+' + stars + ' 星星' : ''].filter(Boolean).join('、');
    stmts.push(ctx.stmt('UPDATE students SET coins = coins + ?, earned = earned + ?, stars = stars + ?, bugs = bugs + 1 WHERE class_code = ? AND seat = ?', coins, coins, stars, a.class_code, a.seat));
  } else if (kind === 'junk' && coins) {
    reward = '-' + coins + ' 金幣';
    stmts.push(ctx.stmt('UPDATE students SET coins = MAX(0, coins - ?) WHERE class_code = ? AND seat = ?', coins, a.class_code, a.seat));
  }
  stmts.push(ctx.stmt('UPDATE asks SET status = ?, reply = ?, public = ?, reward = ?, replied = ? WHERE id = ?', kind, reply, data.pub && kind !== 'junk' && kind !== 'warn' ? 1 : 0, reward, stampNow(), a.id));
  await ctx.db.batch(stmts);
  return true;
};

/** Claude 用：待處理的提問（截圖用網址讀） */
API.xAsks = async ctx => {
  checkImport(ctx);
  const rows = await ctx.all("SELECT * FROM asks WHERE status = 'open' ORDER BY id LIMIT 50");
  return rows.map(a => ({ id: a.id, ts: a.ts, class: a.class_code, seat: a.seat, text: a.text, image: a.image ? '/img/' + a.image : '', draft: a.draft, draftKind: a.draft_kind }));
};
/** Claude 用：寫回覆草稿（老師在後台看過、按送出才會給學生） */
API.xDraftAsk = async (ctx, id, kind, reply, note) => {
  checkImport(ctx);
  const r = await ctx.run("UPDATE asks SET draft = ?, draft_kind = ?, draft_note = ? WHERE id = ? AND status = 'open'",
    str(reply, 300), ASK_KINDS.includes(kind) ? kind : 'answered', str(note, 300), Math.floor(num(id)));
  if (!r.meta.changes) fail('找不到這則待處理的提問。');
  return true;
};

API.tReports = async (ctx, pw) => {
  await checkPw(ctx, pw);
  const rows = await ctx.all(`SELECT r.id AS rid, r.qid, r.reason, r.note, r.ts, r.class_code, r.seat, r.answer AS ranswer, r.draft AS rdraft, r.draft_kind AS rkind, r.draft_note AS rnote, q.* FROM reports r JOIN questions q ON q.id = r.qid
    WHERE r.status = 'open' ORDER BY r.id`);
  const by = {};
  rows.forEach(r => {
    const g = by[r.qid] = by[r.qid] || { q: Object.assign({}, r, { reason: undefined, note: undefined, ts: undefined, class_code: undefined, seat: undefined, rid: undefined, ranswer: undefined, rdraft: undefined, rkind: undefined, rnote: undefined }), reports: [], draft: '', draftKind: '', draftNote: '' };
    g.reports.push({ id: r.rid, reason: r.reason, note: r.note, ts: r.ts, who: r.class_code + ' ' + r.seat + ' 號', answer: r.ranswer });
    if (r.rdraft && !g.draft) Object.assign(g, { draft: r.rdraft, draftKind: r.rkind, draftNote: r.rnote });
  });
  return Object.values(by).sort((a, b) => b.reports.length - a.reports.length);
};

/** 處理回報：confirmed = true 代表老師確認題目真的有問題（學生會得到「題目偵探」徽章） */
/* 處理回報：result = confirmed（真的有問題，學生得「題目偵探」）或 ok（沒問題）；reply 是給學生的回覆；
 * junk 是亂回報的回報 id 清單，那些學生扣 coins 枚金幣（不會扣成負數），其他照 result。學生下次登入會看到結果。 */
API.tResolveReports = async (ctx, pw, qid, result, reply, junk, coins) => {
  await checkPw(ctx, pw);
  const confirmed = result === true || result === 'confirmed';
  const rows = await ctx.all("SELECT id, class_code, seat FROM reports WHERE qid = ? AND status = 'open'", str(qid, 40));
  const bad = new Set((Array.isArray(junk) ? junk : []).map(x => Math.floor(num(x))));
  const pen = Math.max(0, Math.min(200, coins === undefined ? JUNK_PENALTY : Math.floor(num(coins))));
  const msg = str(reply, 300) || (confirmed ? '謝謝你！這題真的有問題，老師已經處理了。' : '老師檢查過了，這題沒有問題。再看一次題目和解析喔！');
  const stmts = [];
  rows.forEach(r => {
    if (bad.has(r.id)) {
      stmts.push(ctx.stmt("UPDATE reports SET status = 'done', result = 'junk', reply = ?, penalty = ?, seen = 0 WHERE id = ?", str(reply, 300) || '這題沒有問題，請不要亂回報喔。', pen, r.id));
      if (pen) stmts.push(ctx.stmt('UPDATE students SET coins = MAX(0, coins - ?) WHERE class_code = ? AND seat = ?', pen, r.class_code, r.seat));
    } else stmts.push(ctx.stmt('UPDATE reports SET status = ?, result = ?, reply = ?, seen = 0 WHERE id = ?', confirmed ? 'confirmed' : 'done', confirmed ? 'confirmed' : 'ok', msg, r.id));
  });
  if (stmts.length) await ctx.db.batch(stmts);
  return true;
};
/** Claude 用：待檢查的題目（含題目全文、答案、解析、學生選了什麼） */
API.xReports = async ctx => {
  checkImport(ctx);
  const rows = await ctx.all(`SELECT r.id AS rid, r.qid, r.reason, r.note, r.answer AS ranswer, r.class_code, r.seat, r.draft AS rdraft, q.* FROM reports r JOIN questions q ON q.id = r.qid
    WHERE r.status = 'open' ORDER BY r.id LIMIT 200`);
  const by = {};
  rows.forEach(r => {
    const g = by[r.qid] = by[r.qid] || { qid: r.qid, subject: r.subject, unit: r.unit, version: r.version, type: r.type, passage: r.passage, text: r.text, a: r.a, b: r.b, c: r.c, d: r.d, answer: r.answer, explain: r.explain, image: r.image ? '/img/' + r.image : '', hasDraft: false, reports: [] };
    g.reports.push({ id: r.rid, class: r.class_code, seat: r.seat, reason: r.reason, note: r.note, answer: r.ranswer });
    if (r.rdraft) g.hasDraft = true;
  });
  return Object.values(by);
};
/** Claude 用：寫審核建議（kind：confirmed 真的有問題、ok 沒問題），老師看過按鈕才會處理 */
API.xDraftReport = async (ctx, qid, kind, reply, note) => {
  checkImport(ctx);
  const r = await ctx.run("UPDATE reports SET draft = ?, draft_kind = ?, draft_note = ? WHERE qid = ? AND status = 'open'",
    str(reply, 300), kind === 'confirmed' ? 'confirmed' : 'ok', str(note, 500), str(qid, 40));
  if (!r.meta.changes) fail('找不到這一題待檢查的回報。');
  return true;
};
/** Claude 用：還沒有提示的題目（老師班上已教的單元優先），批次寫提示 */
API.xHintTodo = async (ctx, limit) => {
  checkImport(ctx);
  const units = new Set((await ctx.all("SELECT units FROM classes WHERE status = '進行中'")).flatMap(c => jsonp(c.units, [])));
  const rows = await ctx.all("SELECT id, subject, unit, unit_key, type, text, a, b, c, d, answer, explain, passage, concept FROM questions WHERE enabled = 1 AND hint = '' AND unit_key IN (SELECT value FROM json_each(?)) LIMIT ?",
    JSON.stringify([...units]), Math.min(200, Math.max(1, Math.floor(num(limit)) || 50)));
  return rows;
};
/** Claude 用：寫入提示（[{id, hint}]，提示不能寫出答案） */
API.xSetHints = async (ctx, list) => {
  checkImport(ctx);
  const stmts = (Array.isArray(list) ? list : []).slice(0, 200).filter(x => x && x.id && x.hint).map(x => ctx.stmt('UPDATE questions SET hint = ? WHERE id = ?', str(x.hint, 200), str(x.id, 40)));
  if (stmts.length) await ctx.batch(stmts);
  if (stmts.length) await bumpBank(ctx);  // 題庫有改，記憶體裡的題庫要重讀
  return stmts.length;
};

/* ---------- 老師頒發的徽章 ---------- */

API.tCustomBadges = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const list = await customBadges(ctx);
  const got = code ? await ctx.all("SELECT badge, seat, note, day FROM badges WHERE class_code = ? AND badge LIKE 'c:%' ORDER BY day DESC", up(code)) : [];
  return list.map(b => Object.assign(b, { awarded: got.filter(g => g.badge === b.id).map(g => ({ seat: g.seat, note: g.note, day: g.day })) }));
};

API.tSaveCustomBadge = async (ctx, pw, data) => {
  await checkPw(ctx, pw);
  data = data || {};
  const name = str(data.name, 12), icon = str(data.icon, 8) || '⭐', descr = str(data.desc, 40);
  if (!name) fail('請幫徽章取個名字。');
  const id = str(data.id, 40).replace(/^c:/, '');
  if (id) await ctx.run('UPDATE custom_badges SET icon = ?, name = ?, descr = ? WHERE id = ?', icon, name, descr, id);
  else {
    if ((await ctx.first('SELECT COUNT(*) AS n FROM custom_badges')).n >= 50) fail('老師頒發的徽章最多 50 種。');
    await ctx.run('INSERT INTO custom_badges (id, icon, name, descr, created) VALUES (?,?,?,?,?)', Date.now().toString(36).toUpperCase(), icon, name, descr, stampNow());
  }
  return API.tCustomBadges(ctx, pw);
};

API.tDeleteCustomBadge = async (ctx, pw, id) => {
  await checkPw(ctx, pw);
  id = str(id, 40).replace(/^c:/, '');
  await ctx.db.batch([ctx.stmt('DELETE FROM badges WHERE badge = ?', 'c:' + id), ctx.stmt('DELETE FROM custom_badges WHERE id = ?', id)]);
  return true;
};

API.tAwardBadge = async (ctx, pw, code, seats, badgeId, note) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const id = str(badgeId, 40);
  if (!id.startsWith('c:') || !(await ctx.first('SELECT id FROM custom_badges WHERE id = ?', id.slice(2)))) fail('找不到這個徽章。');
  const list = [...new Set((seats || []).map(x => Math.floor(num(x))))].filter(Boolean);
  if (!list.length) fail('請選要頒給哪些學生。');
  await ctx.batch(list.map(seat => ctx.stmt('INSERT OR IGNORE INTO badges (class_code, seat, badge, day, note) VALUES (?,?,?,?,?)', cls.code, seat, id, today(), str(note, 60))));
  return list.length;
};

API.tRevokeBadge = async (ctx, pw, code, seat, badgeId) => {
  await checkPw(ctx, pw);
  const id = str(badgeId, 40);
  if (!id.startsWith('c:')) fail('系統徽章是學生自己達成的，不能收回。');
  await ctx.run('DELETE FROM badges WHERE class_code = ? AND seat = ? AND badge = ?', up(code), Math.floor(num(seat)), id);
  return true;
};

/* ---------- 延伸冒險（外部資源連結） ---------- */

function cleanUrl(u) {
  u = str(u, 500);
  let x;
  try { x = new URL(u); } catch (e) { fail('網址格式不對，請貼完整的網址（https:// 開頭）。'); }
  if (x.protocol !== 'https:' && x.protocol !== 'http:') fail('只能放 http 或 https 開頭的網址。');
  return x.toString();
}

/* 延伸冒險可以掛在整個科目（版本｜學期｜科目｜＊全部單元）：那一科有任何一課勾了已教過，就看得到 */
const ALL_UNITS = '＊全部單元';
const linkKeys = cls => { const u = JSON.parse(cls.units || '[]'); return JSON.stringify([...new Set(u.concat(u.map(k => k.split('｜').slice(0, 3).join('｜') + '｜' + ALL_UNITS)))]); };

API.getLinks = async (ctx, cred) => {
  const { cls, s } = await auth(ctx, cred, false);
  const rows = await ctx.all(`SELECT l.*, (SELECT 1 FROM link_done d WHERE d.class_code = ? AND d.seat = ? AND d.link_id = l.id) AS done,
    (SELECT 1 FROM link_open o WHERE o.class_code = ? AND o.seat = ? AND o.link_id = l.id) AS opened
    FROM links l WHERE l.unit_key IN (SELECT value FROM json_each(?)) ORDER BY l.created`, cls.code, s.seat, cls.code, s.seat, linkKeys(cls));
  return rows.map(r => {
    const [, , subject, unit] = r.unit_key.split('｜');
    let host = ''; try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch (e) {}
    return { id: r.id, subject, unit: unit === ALL_UNITS ? '全部單元' : unit, title: r.title, url: r.url, host, note: r.note, star: !!r.star, done: !!r.done, opened: !!(r.opened || r.done) };
  });
};

API.openLink = async (ctx, cred, id) => {
  const { cls, s } = await auth(ctx, cred, false);
  const l = await ctx.first('SELECT id FROM links WHERE id = ? AND unit_key IN (SELECT value FROM json_each(?))', str(id, 40), linkKeys(cls));
  if (!l) fail('找不到這個延伸冒險。');
  await ctx.run('INSERT OR IGNORE INTO link_open (class_code, seat, link_id) VALUES (?,?,?)', cls.code, s.seat, l.id);
  return true;
};

API.completeLink = async (ctx, cred, id) => {
  const { cls, s } = await auth(ctx, cred, false);
  const l = await ctx.first('SELECT * FROM links WHERE id = ? AND unit_key IN (SELECT value FROM json_each(?))', str(id, 40), linkKeys(cls));
  if (!l) fail('找不到這個延伸冒險。');
  if (!(await ctx.first('SELECT 1 AS x FROM link_open WHERE class_code = ? AND seat = ? AND link_id = ?', cls.code, s.seat, l.id))
    && !(await ctx.first('SELECT 1 AS x FROM link_done WHERE class_code = ? AND seat = ? AND link_id = ?', cls.code, s.seat, l.id))) fail('先按「出發」去看看，回來才能按「我完成了」喔！');
  const r = await ctx.run('INSERT OR IGNORE INTO link_done (class_code, seat, link_id, day) VALUES (?,?,?,?)', cls.code, s.seat, l.id, today());
  const first = r.meta.changes > 0;
  if (first && l.star) { await ctx.run('UPDATE students SET stars = stars + 1 WHERE class_code = ? AND seat = ?', cls.code, s.seat); s.stars += 1; }
  return { first, star: first && !!l.star, state: await state(ctx, cls, s) };
};

API.tLinks = async (ctx, pw, code) => {
  await checkPw(ctx, pw);
  const cls = await findClass(ctx, code);
  const rows = await ctx.all(`SELECT l.*, (SELECT COUNT(*) FROM link_done d WHERE d.class_code = ? AND d.link_id = l.id) AS doneN
    FROM links l ORDER BY l.unit_key, l.created`, cls.code);
  return rows.map(r => ({ id: r.id, unitKey: r.unit_key, title: r.title, url: r.url, note: r.note, star: !!r.star, doneN: r.doneN }));
};

const linkUnitOk = (ctx, k) => k.endsWith('｜' + ALL_UNITS)
  ? ctx.first("SELECT unit_key FROM questions WHERE unit_key LIKE ? UNION SELECT unit_key FROM units WHERE unit_key LIKE ? LIMIT 1", k.slice(0, -ALL_UNITS.length) + '%', k.slice(0, -ALL_UNITS.length) + '%')
  : ctx.first('SELECT unit_key FROM questions WHERE unit_key = ? UNION SELECT unit_key FROM units WHERE unit_key = ? LIMIT 1', k, k);

API.tSaveLink = async (ctx, pw, data) => {
  await checkPw(ctx, pw);
  data = data || {};
  const unitKey = str(data.unitKey, 200), title = str(data.title, 40), note = str(data.note, 80);
  if (!unitKey || !(await linkUnitOk(ctx, unitKey))) fail('請選一個單元。');
  if (!title) fail('請幫連結取個名稱。');
  const url = cleanUrl(data.url);
  const id = str(data.id, 40);
  if (id) await ctx.run('UPDATE links SET unit_key = ?, title = ?, url = ?, note = ?, star = ? WHERE id = ?', unitKey, title, url, note, data.star ? 1 : 0, id);
  else {
    if ((await ctx.first('SELECT COUNT(*) AS n FROM links')).n >= 1000) fail('連結太多了，請先刪掉一些。');
    await ctx.run('INSERT INTO links (id, unit_key, title, url, note, star, created) VALUES (?,?,?,?,?,?,?)', 'L' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(), unitKey, title, url, note, data.star ? 1 : 0, stampNow());
  }
  return true;
};

API.tDeleteLink = async (ctx, pw, id) => {
  await checkPw(ctx, pw);
  id = str(id, 40);
  await ctx.db.batch([ctx.stmt('DELETE FROM link_done WHERE link_id = ?', id), ctx.stmt('DELETE FROM links WHERE id = ?', id)]);
  return true;
};

/* ---------- 徽章排行榜 ---------- */

API.leaderboard = async (ctx, cred) => {
  const { cls, s } = await auth(ctx, cred, false);
  const set = await ctx.settings();
  if (set.show_leaderboard === '0') fail('老師目前沒有開放排行榜。');
  const rows = await ctx.all(`SELECT st.seat, st.nick, COUNT(b.badge) AS n, MAX(b.day) AS last FROM students st
    LEFT JOIN badges b ON b.class_code = st.class_code AND b.seat = st.seat
    WHERE st.class_code = ? AND st.pin <> '' AND st.is_test = 0 GROUP BY st.seat ORDER BY n DESC, last ASC, st.seat`, cls.code);
  let rank = 0, prev = -1;
  return { total: BADGES.length + (await customBadges(ctx)).length, rows: rows.map((r, i) => { if (r.n !== prev) { rank = i + 1; prev = r.n; } return { rank, name: r.nick || (r.seat + ' 號'), n: r.n, me: r.seat === s.seat }; }) };
};

/* ---------- 設定與匯出 ---------- */

API.tGetSettings = async (ctx, pw) => {
  await checkPw(ctx, pw);
  const s = await ctx.settings();
  return { perRound: num(s.per_round) || 10, passRatio: num(s.pass_ratio) || 0.7, perStamp: num(s.per_stamp), coinsPerPoint: num(s.coins_per_point), perMastery: num(s.per_mastery), showLeaderboard: s.show_leaderboard !== '0', credit: s.credit || '', customPw: !!s.teacher_pw_hash, focusSubjects: (await focusConf(ctx)).subjects, focusStamp: s.focus_stamp !== '0', outsideRate: (await focusConf(ctx)).outside, subjects: SUBJECTS };
};

API.tSaveSettings = async (ctx, pw, data) => {
  await checkPw(ctx, pw);
  data = data || {};
  const put = (k, v) => ctx.stmt('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  const stmts = [];
  if (data.perRound !== undefined) stmts.push(put('per_round', Math.min(30, Math.max(3, Math.floor(num(data.perRound)) || 10))));
  if (data.passRatio !== undefined) stmts.push(put('pass_ratio', Math.min(1, Math.max(0.1, num(data.passRatio) || 0.7))));
  if (data.perStamp !== undefined) stmts.push(put('per_stamp', Math.min(100, Math.max(0, Math.floor(num(data.perStamp))))));
  if (data.coinsPerPoint !== undefined) stmts.push(put('coins_per_point', Math.min(10000, Math.max(0, Math.floor(num(data.coinsPerPoint))))));
  if (data.credit !== undefined) stmts.push(put('credit', str(data.credit, 80)));
  if (data.showLeaderboard !== undefined) stmts.push(put('show_leaderboard', data.showLeaderboard ? '1' : '0'));
  if (Array.isArray(data.focusSubjects)) stmts.push(put('focus_subjects', JSON.stringify(data.focusSubjects.filter(x => SUBJECTS.includes(x)))));
  if (data.outsideRate !== undefined) stmts.push(put('outside_rate', Math.min(1, Math.max(0, Math.round(num(data.outsideRate) * 10) / 10))));
  if (data.focusStamp !== undefined) stmts.push(put('focus_stamp', data.focusStamp ? '1' : '0'));
  if (data.perMastery !== undefined) stmts.push(put('per_mastery', Math.min(100, Math.max(0, Math.floor(num(data.perMastery))))));
  if (data.newPw !== undefined) {
    const np = String(data.newPw);
    if (np.length < 6) fail('新密碼至少要 6 個字。');
    const salt = crypto.randomUUID();
    stmts.push(put('teacher_pw_salt', salt), put('teacher_pw_hash', await sha256(salt + np)));
  }
  if (stmts.length) await ctx.db.batch(stmts);
  ctx._set = null;
  return API.tGetSettings(ctx, data.newPw !== undefined ? data.newPw : pw);
};

/** 匯出資料給 Excel（前端轉成 CSV 下載） */
API.tExport = async (ctx, pw, what, code) => {
  await checkPw(ctx, pw);
  if (what === 'questions') return ctx.all('SELECT version AS 版本, grade AS 年級, sem AS 學期, subject AS 科目, unit AS 單元, concept AS 觀念, type AS 題型, text AS 題目, a AS 選項A, b AS 選項B, c AS 選項C, d AS 選項D, answer AS 答案, explain AS 解析, passage AS 情境, source AS 來源, CASE enabled WHEN 1 THEN \'Y\' ELSE \'N\' END AS 啟用, id AS 題號 FROM questions ORDER BY version, grade, sem, subject, unit, id');
  const cls = await findClass(ctx, code);
  if (what === 'students') {
    const rt = await rate(ctx);
    return (await ctx.all('SELECT * FROM students WHERE class_code = ? ORDER BY seat', cls.code)).map(s => ({
      座號: s.seat, 暱稱: s.nick, 測試帳號: s.is_test ? '是' : '', 金幣餘額: s.coins, 累積金幣: s.earned, 未換金幣: s.earned - s.coins_redeemed, 星星: s.stars, 印章: s.stamps, 未換印章: s.stamps - s.stamps_redeemed,
      可加點數: (s.stamps - s.stamps_redeemed) * rt.perStamp + (rt.coinsPerPoint > 0 ? Math.floor((s.earned - s.coins_redeemed) / rt.coinsPerPoint) : 0),
      連續天數: liveStreak(s), 最後完成日: s.last_day, 總答題: s.total, 答對題: s.right_count, 正確率: s.total ? Math.round(s.right_count / s.total * 100) + '%' : ''
    }));
  }
  if (what === 'points') return (await API.tPointsLog(ctx, pw, cls.code)).map(r => ({ 時間: r.ts, 座號: r.seat, 暱稱: r.nick, 點數: r.points, 用掉印章: r.stamps, 用掉累積金幣: r.coins, 精熟單元: r.mastery, 備註: r.note }));
  if (what === 'logs') return ctx.all('SELECT ts AS 時間, seat AS 座號, subject AS 科目, unit AS 單元, qid AS 題號, answer AS 作答, CASE ok WHEN 1 THEN \'對\' ELSE \'錯\' END AS 對錯 FROM logs WHERE class_code = ? ORDER BY id DESC LIMIT 20000', cls.code);
  fail('沒有這種匯出。');
};
