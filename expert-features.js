'use strict';

const crypto = require('node:crypto');

const TASKS = [
  { id: 'register_device', title: 'Register this device', description: 'Have Expert eSIM detect and register this device.', points: 20, cadence: 'once' },
  { id: 'verify_email', title: 'Verify your account email', description: 'Secure your Expert eSIM account email address.', points: 10, cadence: 'once' },
  { id: 'speed_test', title: 'Run a network speed test', description: 'Complete a speed test through your Expert eSIM Railway service.', points: 5, cadence: 'daily' },
  { id: 'activate_profile', title: 'Activate an Expert eSIM profile', description: 'Rewarded after an authorised profile is installed and confirmed active.', points: 30, cadence: 'once' }
];

function createExpertFeatures({ loadStore, transact }) {
  const today = () => new Date().toISOString().slice(0, 10);
  const ref = prefix => prefix + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const ensure = store => {
    for (const name of ['rewardLedger','rewardClaims','speedTests','referrals','coupons','couponClaims','redeemCodes','storeItems','storeOrders','airtimeRequests','featureMessages','dataGrants']) {
      if (!Array.isArray(store[name])) store[name] = [];
    }
    for (const user of store.users) {
      if (!user.referralCode) user.referralCode = ref('EX');
    }
    return store;
  };
  const balance = (store, userId) => store.rewardLedger
    .filter(x => x.userId === userId)
    .reduce((sum, x) => sum + Number(x.delta || 0), 0);
  const addPoints = (store, userId, delta, reason, reference) => {
    if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('Invalid points transaction.');
    if (reference && store.rewardLedger.some(x => x.reference === reference && x.userId === userId)) return null;
    const entry = { id: crypto.randomUUID(), userId, delta, reason, reference: reference || ref('POINT'), createdAt: new Date().toISOString() };
    store.rewardLedger.push(entry);
    store.audit.push({ id: crypto.randomUUID(), event: 'rewards.points_' + (delta > 0 ? 'credited' : 'debited'), subject: userId, at: entry.createdAt });
    return entry;
  };
  const userById = (store, userId) => store.users.find(x => x.id === userId && x.status === 'active');
  const safeMessage = item => ({ id: item.id, title: item.title, message: item.message, type: item.type, readAt: item.readAt || null, createdAt: item.createdAt });

  async function qualifyReferrals() {
    await transact(store => {
      ensure(store);
      for (const referral of store.referrals) {
        if (referral.status !== 'pending') continue;
        const referred = userById(store, referral.invitedUserId);
        const hasDevice = store.devices.some(x => x.userId === referral.invitedUserId);
        if (referred && referred.emailVerified && hasDevice) {
          referral.status = 'qualified';
          referral.qualifiedAt = new Date().toISOString();
          addPoints(store, referral.referrerUserId, 25, 'Successful referral', 'referral-referrer:' + referral.id);
          addPoints(store, referral.invitedUserId, 10, 'Welcome reward from referral', 'referral-invitee:' + referral.id);
          const at = new Date().toISOString();
          store.featureMessages.push({ id: crypto.randomUUID(), userId: referral.referrerUserId, title: 'Referral reward earned', message: 'Your invited member verified their account and registered a device. 25 Expert Points were added to your rewards wallet.', type: 'reward', createdAt: at });
        }
      }
    });
  }

  function taskState(store, user) {
    const date = today();
    const hasDevice = store.devices.some(x => x.userId === user.id);
    const hasSpeedTest = store.speedTests.some(x => x.userId === user.id && String(x.createdAt).slice(0,10) === date);
    const hasActiveProfile = store.profiles.some(x => x.userId === user.id && x.status === 'active');
    const dailyClaimed = store.rewardClaims.some(x => x.userId === user.id && x.type === 'daily_checkin' && x.day === date);
    const referralsQualified = store.referrals.filter(x => x.referrerUserId === user.id && x.status === 'qualified').length;
    return [
      { id: 'daily_checkin', title: 'Daily check-in', description: 'Open Expert eSIM once each day to collect your daily points.', points: 10, cadence: 'daily', eligible: !dailyClaimed, claimed: dailyClaimed },
      ...TASKS.map(task => {
        const already = store.rewardClaims.some(x => x.userId === user.id && x.taskId === task.id && (task.cadence !== 'daily' || x.day === date));
        const eligible = task.id === 'register_device' ? hasDevice
          : task.id === 'verify_email' ? user.emailVerified
          : task.id === 'speed_test' ? hasSpeedTest
          : task.id === 'activate_profile' ? hasActiveProfile : false;
        return { ...task, eligible: eligible && !already, claimed: already, progress: task.id === 'register_device' ? (hasDevice ? 1 : 0) : task.id === 'verify_email' ? (user.emailVerified ? 1 : 0) : task.id === 'speed_test' ? (hasSpeedTest ? 1 : 0) : (hasActiveProfile ? 1 : 0), target: 1 };
      }),
      { id: 'refer_friend', title: 'Invite a friend', description: 'Earn 25 points when a referred member verifies their email and registers a device.', points: 25, cadence: 'per-qualified-referral', eligible: false, claimed: false, progress: referralsQualified, target: null }
    ];
  }

  async function summary(user) {
    await qualifyReferrals();
    const store = ensure(await loadStore());
    const devices = store.devices.filter(x => x.userId === user.id);
    const profiles = store.profiles.filter(x => x.userId === user.id);
    const points = balance(store, user.id);
    return {
      pointsBalance: points,
      pointsEarned: store.rewardLedger.filter(x => x.userId === user.id && x.delta > 0).reduce((s,x) => s + x.delta, 0),
      pointsSpent: Math.abs(store.rewardLedger.filter(x => x.userId === user.id && x.delta < 0).reduce((s,x) => s + x.delta, 0)),
      devices: devices.length,
      profiles: profiles.length,
      activeProfiles: profiles.filter(x => x.status === 'active').length,
      pendingProfiles: profiles.filter(x => !['active','profile_issued','provider_error','cancelled'].includes(x.status)).length,
      dailyCheckinAvailable: !store.rewardClaims.some(x => x.userId === user.id && x.type === 'daily_checkin' && x.day === today()),
      dailySpinAvailable: !store.rewardClaims.some(x => x.userId === user.id && x.type === 'daily_spin' && x.day === today()),
      tasks: taskState(store,user),
      referralCode: user.referralCode,
      referralCount: store.referrals.filter(x => x.referrerUserId === user.id).length,
      qualifiedReferrals: store.referrals.filter(x => x.referrerUserId === user.id && x.status === 'qualified').length
    };
  }

  async function checkIn(user) {
    return transact(store => {
      ensure(store);
      const date = today();
      if (store.rewardClaims.some(x => x.userId === user.id && x.type === 'daily_checkin' && x.day === date)) {
        throw Object.assign(new Error('You have already collected today’s check-in reward.'), { statusCode: 409 });
      }
      const claim = { id: crypto.randomUUID(), userId: user.id, type: 'daily_checkin', day: date, points: 10, createdAt: new Date().toISOString() };
      store.rewardClaims.push(claim);
      addPoints(store, user.id, 10, 'Daily check-in', 'daily-checkin:' + user.id + ':' + date);
      return { claim, pointsBalance: balance(store,user.id), message: '10 Expert Points added to your rewards wallet.' };
    });
  }

  async function spinReward(user) {
    return transact(store => {
      ensure(store);
      const date = today();
      if (store.rewardClaims.some(x => x.userId === user.id && x.type === 'daily_spin' && x.day === date)) {
        throw Object.assign(new Error('You have already used today’s free rewards spin.'), { statusCode: 409 });
      }
      const prizes = [5, 10, 15, 20, 30];
      const points = prizes[crypto.randomInt(prizes.length)];
      const claim = { id: crypto.randomUUID(), userId: user.id, type: 'daily_spin', day: date, points, createdAt: new Date().toISOString() };
      store.rewardClaims.push(claim);
      addPoints(store, user.id, points, 'Free daily rewards spin', 'daily-spin:' + user.id + ':' + date);
      return { claim, pointsBalance: balance(store,user.id), message: 'Your free spin awarded ' + points + ' Expert Points.' };
    });
  }

  async function claimTask(user, taskId) {
    if (!TASKS.some(x => x.id === taskId)) throw Object.assign(new Error('Unknown task.'), { statusCode: 404 });
    return transact(store => {
      ensure(store);
      const task = TASKS.find(x => x.id === taskId);
      const date = today();
      const duplicate = store.rewardClaims.some(x => x.userId === user.id && x.taskId === taskId && (task.cadence !== 'daily' || x.day === date));
      if (duplicate) throw Object.assign(new Error('This task reward has already been collected.'), { statusCode: 409 });
      const eligible = taskId === 'register_device' ? store.devices.some(x => x.userId === user.id)
        : taskId === 'verify_email' ? Boolean(userById(store,user.id)?.emailVerified)
        : taskId === 'speed_test' ? store.speedTests.some(x => x.userId === user.id && String(x.createdAt).slice(0,10) === date)
        : taskId === 'activate_profile' ? store.profiles.some(x => x.userId === user.id && x.status === 'active') : false;
      if (!eligible) throw Object.assign(new Error('Complete the task requirements before collecting this reward.'), { statusCode: 409 });
      const claim = { id: crypto.randomUUID(), userId: user.id, type: 'task', taskId, day: date, points: task.points, createdAt: new Date().toISOString() };
      store.rewardClaims.push(claim);
      addPoints(store, user.id, task.points, task.title, 'task:' + user.id + ':' + taskId + ':' + (task.cadence === 'daily' ? date : 'once'));
      return { claim, pointsBalance: balance(store,user.id), message: task.points + ' Expert Points added.' };
    });
  }

  async function recordSpeedTest(user, data) {
    const downloadMbps = Number(data.downloadMbps), uploadMbps = Number(data.uploadMbps), pingMs = Number(data.pingMs);
    if (![downloadMbps,uploadMbps,pingMs].every(Number.isFinite) || downloadMbps < 0 || uploadMbps < 0 || pingMs < 0 || downloadMbps > 100000 || uploadMbps > 100000 || pingMs > 600000) {
      throw Object.assign(new Error('Speed-test measurements are invalid.'), { statusCode: 400 });
    }
    return transact(store => {
      ensure(store);
      const record = { id: crypto.randomUUID(), userId: user.id, downloadMbps, uploadMbps, pingMs, jitterMs: Math.max(0,Math.min(600000,Number(data.jitterMs)||0)), createdAt: new Date().toISOString() };
      store.speedTests.push(record);
      if (store.speedTests.length > 10000) store.speedTests.splice(0, store.speedTests.length - 10000);
      return record;
    });
  }

  async function wallet(user) {
    const store = ensure(await loadStore());
    return {
      currency: 'Expert Points',
      pointsBalance: balance(store,user.id),
      transactions: store.rewardLedger.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,100)
    };
  }

  async function transferPoints(user, data) {
    const recipientCode = String(data.recipientCode || '').trim().toUpperCase();
    const amount = Number(data.points);
    if (!recipientCode || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000) throw Object.assign(new Error('Enter a valid recipient code and points amount.'), { statusCode: 400 });
    return transact(store => {
      ensure(store);
      const sender = userById(store,user.id);
      const recipient = store.users.find(x => x.referralCode === recipientCode && x.status === 'active');
      if (!recipient) throw Object.assign(new Error('No active Expert eSIM account matches that referral code.'), { statusCode: 404 });
      if (recipient.id === sender.id) throw Object.assign(new Error('You cannot transfer points to yourself.'), { statusCode: 400 });
      if (balance(store,sender.id) < amount) throw Object.assign(new Error('Your Expert Points balance is too low.'), { statusCode: 409 });
      const transferRef = ref('XFER');
      addPoints(store,sender.id,-amount,'Points sent to another member',transferRef + ':out');
      addPoints(store,recipient.id,amount,'Points received from another member',transferRef + ':in');
      const transfer = { id: crypto.randomUUID(), reference: transferRef, senderUserId: sender.id, recipientUserId: recipient.id, points: amount, createdAt: new Date().toISOString() };
      store.rewardClaims.push({ ...transfer, type: 'points_transfer' });
      store.featureMessages.push({ id: crypto.randomUUID(), userId: recipient.id, title: 'Expert Points received', message: amount + ' Expert Points were transferred to your rewards wallet.', type: 'reward', createdAt: transfer.createdAt });
      return { transfer, pointsBalance: balance(store,sender.id) };
    });
  }

  async function referrals(user) {
    await qualifyReferrals();
    const store = ensure(await loadStore());
    return {
      code: user.referralCode,
      sharePath: '/?ref=' + encodeURIComponent(user.referralCode),
      total: store.referrals.filter(x => x.referrerUserId === user.id).length,
      qualified: store.referrals.filter(x => x.referrerUserId === user.id && x.status === 'qualified').length,
      records: store.referrals.filter(x => x.referrerUserId === user.id).map(x => ({ status: x.status, createdAt: x.createdAt, qualifiedAt: x.qualifiedAt || null }))
    };
  }

  async function coupons(user) {
    const store = ensure(await loadStore());
    const claimedIds = new Set(store.couponClaims.filter(x => x.userId === user.id).map(x => x.couponId));
    return {
      available: store.coupons.filter(x => x.status === 'active' && (!x.expiresAt || Date.parse(x.expiresAt) > Date.now())).map(x => ({ ...x, claimed: claimedIds.has(x.id) })),
      mine: store.couponClaims.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))
    };
  }

  async function claimCoupon(user, couponId) {
    return transact(store => {
      ensure(store);
      const coupon = store.coupons.find(x => x.id === couponId && x.status === 'active' && (!x.expiresAt || Date.parse(x.expiresAt) > Date.now()));
      if (!coupon) throw Object.assign(new Error('This coupon is no longer available.'), { statusCode: 404 });
      if (store.couponClaims.some(x => x.userId === user.id && x.couponId === couponId)) throw Object.assign(new Error('You have already collected this coupon.'), { statusCode: 409 });
      const claim = { id: crypto.randomUUID(), userId: user.id, couponId, title: coupon.title, status: coupon.type === 'data_bonus' ? 'awaiting_provider' : 'collected', createdAt: new Date().toISOString() };
      store.couponClaims.push(claim);
      if (coupon.type === 'points' && Number.isSafeInteger(coupon.points) && coupon.points > 0) addPoints(store,user.id,coupon.points,'Coupon reward: ' + coupon.title,'coupon:' + claim.id);
      if (coupon.type === 'data_bonus') {
        store.dataGrants.push({ id: crypto.randomUUID(), userId: user.id, source: 'coupon', sourceId: coupon.id, dataMb: Number(coupon.dataMb)||0, status: 'awaiting_provider', createdAt: claim.createdAt });
      }
      return { claim, message: coupon.type === 'data_bonus' ? 'Coupon collected. Data credit will be applied only after an authorised network provider accepts the grant.' : 'Coupon collected successfully.' };
    });
  }

  async function redeemCode(user, data) {
    const code = String(data.code || '').trim().toUpperCase().replace(/\s+/g,'');
    if (code.length < 6 || code.length > 80) throw Object.assign(new Error('Enter a valid reward code.'), { statusCode: 400 });
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    return transact(store => {
      ensure(store);
      const item = store.redeemCodes.find(x => x.codeHash === hash && x.status === 'active' && (!x.expiresAt || Date.parse(x.expiresAt) > Date.now()));
      if (!item) throw Object.assign(new Error('This code is invalid, expired or already disabled.'), { statusCode: 404 });
      if (store.rewardClaims.some(x => x.userId === user.id && x.codeId === item.id)) throw Object.assign(new Error('This code has already been redeemed by your account.'), { statusCode: 409 });
      const claim = { id: crypto.randomUUID(), userId: user.id, codeId: item.id, type: 'redeem_code', points: item.points || 0, status: item.type === 'data_bonus' ? 'awaiting_provider' : 'redeemed', createdAt: new Date().toISOString() };
      store.rewardClaims.push(claim);
      if (item.type === 'points') addPoints(store,user.id,Number(item.points),'Redeemed reward code','code:' + item.id + ':' + user.id);
      if (item.type === 'data_bonus') store.dataGrants.push({ id: crypto.randomUUID(), userId: user.id, source: 'redeem_code', sourceId: item.id, dataMb: Number(item.dataMb)||0, status: 'awaiting_provider', createdAt: claim.createdAt });
      if (item.maxRedemptions > 0) {
        item.redemptionCount = (item.redemptionCount || 0) + 1;
        if (item.redemptionCount >= item.maxRedemptions) item.status = 'exhausted';
      }
      return { claim, message: item.type === 'data_bonus' ? 'Code accepted. Data credit remains pending provider authorisation.' : Number(item.points) + ' Expert Points added to your wallet.' };
    });
  }

  async function storeCatalog(user) {
    const store = ensure(await loadStore());
    const items = store.storeItems.filter(x => x.status === 'active').map(x => ({ id:x.id,title:x.title,description:x.description,pointsCost:x.pointsCost,type:x.type,status:x.status }));
    const orders = store.storeOrders.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    return { items, orders };
  }

  async function redeemItem(user, itemId) {
    return transact(store => {
      ensure(store);
      const item = store.storeItems.find(x => x.id === itemId && x.status === 'active');
      if (!item) throw Object.assign(new Error('This reward is not available.'), { statusCode: 404 });
      const cost = Number(item.pointsCost);
      if (!Number.isSafeInteger(cost) || cost < 0) throw Object.assign(new Error('The reward cost is invalid.'), { statusCode: 409 });
      if (balance(store,user.id) < cost) throw Object.assign(new Error('You do not have enough Expert Points.'), { statusCode: 409 });
      const now = new Date().toISOString(), order = { id: crypto.randomUUID(), reference: ref('EXRW'), userId:user.id, itemId:item.id, title:item.title, pointsCost:cost, type:item.type, status:item.type === 'data_bonus' ? 'awaiting_provider' : 'awaiting_sponsor_fulfilment', message:item.type === 'data_bonus' ? 'Waiting for an authorised mobile-data provider to accept the sponsored grant.' : 'Your reward request is waiting for sponsor fulfilment.', createdAt:now, updatedAt:now };
      if (cost > 0) addPoints(store,user.id,-cost,'Redeemed reward: ' + item.title,'store-order:' + order.id);
      store.storeOrders.push(order);
      return order;
    });
  }

  async function airtimeRequest(user, data) {
    const countryCode = String(data.countryCode || '').trim().toUpperCase();
    const phone = String(data.phone || '').trim().replace(/[\s()-]/g,'');
    const amount = Number(data.amount);
    const currency = String(data.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode) || !/^\+?[0-9]{7,16}$/.test(phone) || !Number.isFinite(amount) || amount <= 0 || amount > 100000 || !/^[A-Z]{3}$/.test(currency)) {
      throw Object.assign(new Error('Enter a valid country, phone number, amount and currency.'), { statusCode: 400 });
    }
    return transact(store => {
      ensure(store);
      const now = new Date().toISOString();
      const request = { id: crypto.randomUUID(), reference: ref('AIR'), userId:user.id, countryCode, phone, amount, currency, status:'awaiting_airtime_partner', message:'Request recorded on Expert eSIM. No airtime has been sent because an authorised airtime supplier is not connected yet.', createdAt:now, updatedAt:now };
      store.airtimeRequests.push(request);
      return request;
    });
  }

  async function airtimeHistory(user) {
    const store = ensure(await loadStore());
    return store.airtimeRequests.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function messages(user) {
    const store = ensure(await loadStore());
    return store.featureMessages.filter(x => !x.userId || x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(safeMessage);
  }

  async function markMessageRead(user, messageId) {
    return transact(store => {
      ensure(store);
      const item = store.featureMessages.find(x => x.id === messageId && (!x.userId || x.userId === user.id));
      if (!item) throw Object.assign(new Error('Message not found.'), { statusCode: 404 });
      item.readAt = new Date().toISOString();
      return safeMessage(item);
    });
  }

  async function adminSummary() {
    const store = ensure(await loadStore());
    return {
      membersWithPoints: new Set(store.rewardLedger.filter(x => x.delta > 0).map(x => x.userId)).size,
      totalPointsIssued: store.rewardLedger.filter(x => x.delta > 0).reduce((s,x) => s+x.delta,0),
      coupons: store.coupons.length,
      rewardItems: store.storeItems.length,
      rewardCodes: store.redeemCodes.length,
      pointTransfers: store.rewardClaims.filter(x => x.type === 'points_transfer').length,
      airtimeRequests: store.airtimeRequests.length,
      pendingAirtimeRequests: store.airtimeRequests.filter(x => x.status === 'awaiting_airtime_partner').length,
      pendingDataGrants: store.dataGrants.filter(x => x.status === 'awaiting_provider').length,
      openRewardOrders: store.storeOrders.filter(x => !['fulfilled','cancelled'].includes(x.status)).length,
      messages: store.featureMessages.length
    };
  }

  async function adminCreateCoupon(data) {
    const title = String(data.title || '').trim().slice(0,100);
    const type = String(data.type || 'points');
    const points = Number(data.points || 0), dataMb = Number(data.dataMb || 0);
    if (title.length < 3 || !['points','data_bonus'].includes(type) ||
        (type === 'points' && (!Number.isSafeInteger(points) || points < 1 || points > 100000)) ||
        (type === 'data_bonus' && (!Number.isSafeInteger(dataMb) || dataMb < 1 || dataMb > 100000000))) {
      throw Object.assign(new Error('Enter a title and valid points/data reward.'), { statusCode: 400 });
    }
    return transact(store => {
      ensure(store);
      const item = { id:crypto.randomUUID(), title, description:String(data.description||'').trim().slice(0,500), type, points:type==='points'?points:0, dataMb:type==='data_bonus'?dataMb:0, status:'active', expiresAt:data.expiresAt?new Date(data.expiresAt).toISOString():null, createdAt:new Date().toISOString() };
      store.coupons.push(item);
      return item;
    });
  }

  async function adminCreateStoreItem(data) {
    const title = String(data.title || '').trim().slice(0,100), type = String(data.type || 'digital'), pointsCost = Number(data.pointsCost);
    if (title.length < 3 || !['digital','data_bonus'].includes(type) || !Number.isSafeInteger(pointsCost) || pointsCost < 0 || pointsCost > 1000000) {
      throw Object.assign(new Error('Enter a title, a supported reward type and a valid points cost.'), { statusCode: 400 });
    }
    return transact(store => {
      ensure(store);
      const item = { id:crypto.randomUUID(), title, description:String(data.description||'').trim().slice(0,500), type, pointsCost, status:'active', createdAt:new Date().toISOString() };
      store.storeItems.push(item);
      return item;
    });
  }

  async function adminCreateCode(data) {
    const code = String(data.code || '').trim().toUpperCase().replace(/\s+/g,'');
    const type = String(data.type || 'points'), points = Number(data.points || 0), dataMb = Number(data.dataMb || 0);
    if (code.length < 6 || code.length > 80 || !['points','data_bonus'].includes(type) ||
        (type === 'points' && (!Number.isSafeInteger(points) || points < 1 || points > 100000)) ||
        (type === 'data_bonus' && (!Number.isSafeInteger(dataMb) || dataMb < 1 || dataMb > 100000000))) {
      throw Object.assign(new Error('Enter a code and a valid reward value.'), { statusCode: 400 });
    }
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    return transact(store => {
      ensure(store);
      if (store.redeemCodes.some(x => x.codeHash === codeHash)) throw Object.assign(new Error('This code already exists.'), { statusCode: 409 });
      const item = { id:crypto.randomUUID(), codeHash, type, points:type==='points'?points:0, dataMb:type==='data_bonus'?dataMb:0, maxRedemptions:Math.max(0,Math.min(100000,Number(data.maxRedemptions)||0)), redemptionCount:0, status:'active', expiresAt:data.expiresAt?new Date(data.expiresAt).toISOString():null, createdAt:new Date().toISOString() };
      store.redeemCodes.push(item);
      return { id:item.id, type:item.type, points:item.points, dataMb:item.dataMb, status:item.status };
    });
  }

  async function adminSendMessage(data) {
    const title = String(data.title || '').trim().slice(0,100), message = String(data.message || '').trim().slice(0,2000), userId = String(data.userId || '');
    if (title.length < 2 || message.length < 2) throw Object.assign(new Error('Enter a title and message.'), { statusCode: 400 });
    return transact(store => {
      ensure(store);
      if (userId && !userById(store,userId)) throw Object.assign(new Error('Subscriber not found.'), { statusCode: 404 });
      const item = { id:crypto.randomUUID(), userId:userId || null, title, message, type:String(data.type||'announcement'), createdAt:new Date().toISOString() };
      store.featureMessages.push(item);
      return { id:item.id, title:item.title, message:item.message, type:item.type, createdAt:item.createdAt };
    });
  }

  async function adminAdjustPoints(userId, data) {
    const points = Number(data.points), reason = String(data.reason || 'Admin adjustment').trim().slice(0,160);
    if (!Number.isSafeInteger(points) || points === 0 || Math.abs(points) > 1000000) throw Object.assign(new Error('Enter a non-zero points adjustment.'), { statusCode: 400 });
    return transact(store => {
      ensure(store);
      if (!userById(store,userId)) throw Object.assign(new Error('Subscriber not found.'), { statusCode: 404 });
      if (points < 0 && balance(store,userId) < Math.abs(points)) throw Object.assign(new Error('This adjustment would make the points balance negative.'), { statusCode: 409 });
      const entry = addPoints(store,userId,points,reason,ref('ADMIN'));
      return { entry, pointsBalance:balance(store,userId) };
    });
  }

  async function adminListOrders() {
    const store = ensure(await loadStore());
    return {
      orders:store.storeOrders.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,200),
      airtimeRequests:store.airtimeRequests.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,200),
      dataGrants:store.dataGrants.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,200)
    };
  }

  return {
    summary, checkIn, spinReward, claimTask, recordSpeedTest, wallet, transferPoints, referrals,
    coupons, claimCoupon, redeemCode, storeCatalog, redeemItem, airtimeRequest, airtimeHistory,
    messages, markMessageRead, adminSummary, adminCreateCoupon, adminCreateStoreItem,
    adminCreateCode, adminSendMessage, adminAdjustPoints, adminListOrders
  };
}

module.exports = { createExpertFeatures };
