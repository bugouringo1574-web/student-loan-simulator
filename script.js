// ==========================================
// 1. 税金・社会保険料を考慮した手取り計算
// ==========================================
function calculateNetIncome(grossAnnualMan) {
    const gross = grossAnnualMan * 10000; // 円単位

    // 給与所得控除
    let salaryDeduction = 0;
    if (gross <= 1625000) {
        salaryDeduction = 550000;
    } else if (gross <= 1800000) {
        salaryDeduction = gross * 0.4 - 100000;
    } else if (gross <= 3600000) {
        salaryDeduction = gross * 0.3 + 80000;
    } else if (gross <= 6600000) {
        salaryDeduction = gross * 0.2 + 440000;
    } else if (gross <= 8500000) {
        salaryDeduction = gross * 0.1 + 1100000;
    } else {
        salaryDeduction = 1950000;
    }

    // 社会保険料（健康保険・厚生年金・雇用保険: 約14.8%）
    const socialInsurance = gross * 0.148;

    // 課税所得
    const basicDeduction = 480000; // 基礎控除
    const taxableIncome = Math.max(0, gross - salaryDeduction - socialInsurance - basicDeduction);

    // 所得税計算（復興特別所得税 2.1%加算）
    let incomeTax = 0;
    if (taxableIncome <= 1950000) {
        incomeTax = taxableIncome * 0.05;
    } else if (taxableIncome <= 3300000) {
        incomeTax = taxableIncome * 0.10 - 97500;
    } else if (taxableIncome <= 6950000) {
        incomeTax = taxableIncome * 0.20 - 427500;
    } else if (taxableIncome <= 8999000) {
        incomeTax = taxableIncome * 0.23 - 636000;
    } else {
        incomeTax = taxableIncome * 0.33 - 1536000;
    }
    incomeTax = Math.max(0, incomeTax * 1.021);

    // 住民税計算（一律10% + 均等割 5000円）
    const residentTax = taxableIncome > 0 ? (taxableIncome * 0.10 + 5000) : 0;

    // 年間手取り額
    const netAnnual = gross - socialInsurance - incomeTax - residentTax;
    const netMonthly = netAnnual / 12;

    return {
        netAnnual: Math.max(0, netAnnual),
        netMonthly: Math.max(0, netMonthly)
    };
}

// ==========================================
// 2. 単一ローンの月々返済額計算 (元利均等 PMT)
// ==========================================
function calcPMT(principal, annualRatePct, months) {
    if (principal <= 0 || months <= 0) return 0;
    const r = (annualRatePct / 100) / 12;
    if (r === 0) return principal / months;
    return principal * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

// ==========================================
// 3. 3回分割借入＆繰上げ返済（期間短縮/返済額軽減）シミュレーション
// ==========================================
function simulateLoans(tranches, repaymentYears, customMonthlyPaymentYen, calcMode, earlyRepayment) {
    const totalPrincipal = tranches.reduce((sum, t) => sum + t.amount, 0);
    if (totalPrincipal <= 0) return null;

    let baseTotalMonths = 0;
    let baseMonthlyPayment = 0;
    let tranchesPMT = [];

    if (calcMode === 'byYears') {
        baseTotalMonths = Math.max(1, Math.round(repaymentYears * 12));
        tranchesPMT = tranches.map(t => calcPMT(t.amount, t.rate, baseTotalMonths));
        baseMonthlyPayment = tranchesPMT.reduce((a, b) => a + b, 0);
    } else {
        baseMonthlyPayment = customMonthlyPaymentYen;
        const minInterest = tranches.reduce((sum, t) => sum + (t.amount * (t.rate / 100 / 12)), 0);
        if (baseMonthlyPayment <= minInterest) {
            return { error: '月々の希望返済額が金利利息を下回っているため完済できません。返済額を増やしてください。' };
        }
        let maxMonths = 1;
        tranches.forEach(t => {
            if (t.amount > 0) {
                const pmtShare = baseMonthlyPayment * (t.amount / totalPrincipal);
                const r = t.rate / 100 / 12;
                if (pmtShare > t.amount * r) {
                    const m = r === 0 ? t.amount / pmtShare : -Math.log(1 - (t.amount * r / pmtShare)) / Math.log(1 + r);
                    if (m > maxMonths) maxMonths = Math.ceil(m);
                }
            }
        });
        baseTotalMonths = Math.min(600, maxMonths);
        tranchesPMT = tranches.map(t => calcPMT(t.amount, t.rate, baseTotalMonths));
        baseMonthlyPayment = tranchesPMT.reduce((a, b) => a + b, 0);
    }

    // --- A. 通常返済シミュレーション (Base) ---
    let baseTranches = tranches.map(t => ({ principal: t.amount, rate: t.rate, balance: t.amount }));
    let baseMonthlyHistory = [];
    let baseTotalInterest = 0;
    let baseActualMonths = 0;

    for (let m = 1; m <= 600; m++) {
        let monthInterest = 0;
        let active = false;
        baseTranches.forEach(t => {
            if (t.balance > 0.001) {
                active = true;
                const r = (t.rate / 100) / 12;
                const interest = t.balance * r;
                monthInterest += interest;
                t.balance += interest;
            }
        });

        if (!active) break;
        baseTotalInterest += monthInterest;
        baseActualMonths = m;

        // 返済充当 (高金利優先)
        let budget = baseMonthlyPayment;
        baseTranches.sort((a, b) => b.rate - a.rate);
        let actualPaid = 0;
        baseTranches.forEach(t => {
            if (budget > 0 && t.balance > 0) {
                const pay = Math.min(t.balance, budget);
                t.balance -= pay;
                budget -= pay;
                actualPaid += pay;
                if (t.balance < 0.001) t.balance = 0;
            }
        });

        const currentTotalBalance = baseTranches.reduce((sum, t) => sum + t.balance, 0);
        baseMonthlyHistory.push({
            month: m,
            balance: currentTotalBalance,
            interest: monthInterest,
            payment: actualPaid,
            lumpSum: 0
        });
    }

    const baseTotalPayment = totalPrincipal + baseTotalInterest;

    // --- B. 繰上げ返済シミュレーション (Early Repayment) ---
    let earlyResult = null;
    let earlyMonthlyHistory = [];

    if (earlyRepayment && earlyRepayment.enabled && earlyRepayment.amount > 0) {
        const earlyMonth = Math.round(earlyRepayment.year * 12);
        const earlyType = earlyRepayment.type || 'shorten'; // 'shorten' or 'reduce'

        if (earlyMonth >= baseActualMonths) {
            earlyResult = { error: '繰上げ返済の時期は完済予定月より前の時期を指定してください。' };
        } else {
            let curTranches = tranches.map(t => ({ principal: t.amount, rate: t.rate, balance: t.amount }));
            let earlyTotalInterest = 0;
            let earlyActualMonths = 0;
            let currentPMT = baseMonthlyPayment;
            let newMonthlyPaymentAfterEarly = baseMonthlyPayment;

            for (let m = 1; m <= 600; m++) {
                let monthInterest = 0;
                let active = false;

                curTranches.forEach(t => {
                    if (t.balance > 0.001) {
                        active = true;
                        const r = (t.rate / 100) / 12;
                        const interest = t.balance * r;
                        monthInterest += interest;
                        t.balance += interest;
                    }
                });

                if (!active) break;
                earlyTotalInterest += monthInterest;
                earlyActualMonths = m;

                let lumpSumThisMonth = 0;

                // 指定月に繰上げ返済を実行
                if (m === earlyMonth) {
                    let lump = earlyRepayment.amount;
                    curTranches.sort((a, b) => b.rate - a.rate);
                    curTranches.forEach(t => {
                        if (lump > 0 && t.balance > 0) {
                            const pay = Math.min(t.balance, lump);
                            t.balance -= pay;
                            lump -= pay;
                            lumpSumThisMonth += pay;
                            if (t.balance < 0.001) t.balance = 0;
                        }
                    });

                    // 返済額軽減型の場合、残存期間で各トランチの月々返済額を再計算
                    if (earlyType === 'reduce') {
                        const remainMonths = Math.max(1, baseActualMonths - earlyMonth);
                        const newTranchesPMT = curTranches.map(t => calcPMT(t.balance, t.rate, remainMonths));
                        newMonthlyPaymentAfterEarly = newTranchesPMT.reduce((a, b) => a + b, 0);
                        currentPMT = newMonthlyPaymentAfterEarly;
                    }
                }

                // 通常月返済の充当
                let budget = currentPMT;
                curTranches.sort((a, b) => b.rate - a.rate);
                let regularPaid = 0;
                curTranches.forEach(t => {
                    if (budget > 0 && t.balance > 0) {
                        const pay = Math.min(t.balance, budget);
                        t.balance -= pay;
                        budget -= pay;
                        regularPaid += pay;
                        if (t.balance < 0.001) t.balance = 0;
                    }
                });

                const currentTotalBalance = curTranches.reduce((sum, t) => sum + t.balance, 0);
                earlyMonthlyHistory.push({
                    month: m,
                    balance: currentTotalBalance,
                    interest: monthInterest,
                    payment: regularPaid + lumpSumThisMonth,
                    lumpSum: lumpSumThisMonth
                });
            }

            const earlyTotalPayment = totalPrincipal + earlyTotalInterest;
            const savedInterest = Math.max(0, baseTotalInterest - earlyTotalInterest);
            const shortenedMonths = Math.max(0, baseActualMonths - earlyActualMonths);
            const reducedMonthlyPayment = Math.max(0, baseMonthlyPayment - newMonthlyPaymentAfterEarly);

            earlyResult = {
                type: earlyType,
                newTotalMonths: earlyActualMonths,
                newTotalInterest: earlyTotalInterest,
                newTotalPayment: earlyTotalPayment,
                savedInterest: savedInterest,
                shortenedMonths: shortenedMonths,
                newMonthlyPayment: newMonthlyPaymentAfterEarly,
                reducedMonthlyPayment: reducedMonthlyPayment,
                history: earlyMonthlyHistory
            };
        }
    }

    return {
        totalPrincipal,
        baseMonthlyPayment,
        baseTotalMonths: baseActualMonths,
        baseTotalInterest,
        baseTotalPayment,
        baseHistory: baseMonthlyHistory,
        earlyResult
    };
}

// ==========================================
// 4. SVGチャートの描画
// ==========================================
function renderLoanChart(baseHistory, earlyHistory, totalPrincipal, earlyYear) {
    const svg = document.getElementById('loanChartSvg');
    if (!svg || !baseHistory || baseHistory.length === 0) return;

    const maxMonths = Math.max(baseHistory.length, earlyHistory ? earlyHistory.length : 0, 12);
    const maxBalance = totalPrincipal;

    const width = 450;
    const height = 180;
    const padding = { top: 15, right: 20, bottom: 25, left: 45 };

    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    const getX = (month) => padding.left + (month / maxMonths) * plotWidth;
    const getY = (bal) => padding.top + plotHeight - (bal / maxBalance) * plotHeight;

    // 背景グリッドと目盛り
    let svgContent = '';

    // 水平グリッド (残高)
    for (let i = 0; i <= 4; i++) {
        const val = (maxBalance / 4) * i;
        const y = getY(val);
        svgContent += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#f1f5f9" stroke-width="1" />`;
        svgContent += `<text x="${padding.left - 6}" y="${y + 4}" font-size="9" fill="#94a3b8" text-anchor="end">${Math.round(val / 10000)}万</text>`;
    }

    // 垂直グリッド (年数)
    const maxYears = Math.ceil(maxMonths / 12);
    const yearStep = maxYears > 20 ? 5 : (maxYears > 10 ? 2 : 1);
    for (let yr = 0; yr <= maxYears; yr += yearStep) {
        const x = getX(yr * 12);
        if (x <= width - padding.right) {
            svgContent += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" stroke="#f8fafc" stroke-width="1" />`;
            svgContent += `<text x="${x}" y="${height - 8}" font-size="9" fill="#94a3b8" text-anchor="middle">${yr}年</text>`;
        }
    }

    // 通常返済パス
    let basePathD = `M ${getX(0)} ${getY(totalPrincipal)}`;
    baseHistory.forEach(h => {
        basePathD += ` L ${getX(h.month)} ${getY(h.balance)}`;
    });
    svgContent += `<path d="${basePathD}" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="4,2" />`;

    // 繰上げ返済パス
    if (earlyHistory && earlyHistory.length > 0) {
        let earlyPathD = `M ${getX(0)} ${getY(totalPrincipal)}`;
        let earlyAreaD = `M ${getX(0)} ${getY(totalPrincipal)}`;

        earlyHistory.forEach(h => {
            const px = getX(h.month);
            const py = getY(h.balance);
            earlyPathD += ` L ${px} ${py}`;
            earlyAreaD += ` L ${px} ${py}`;
        });

        const lastPoint = earlyHistory[earlyHistory.length - 1];
        earlyAreaD += ` L ${getX(lastPoint.month)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`;

        // 塗りつぶしグラデーション
        svgContent += `
            <defs>
                <linearGradient id="earlyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>
                </linearGradient>
            </defs>
            <path d="${earlyAreaD}" fill="url(#earlyGrad)" />
            <path d="${earlyPathD}" fill="none" stroke="#10b981" stroke-width="3" />
        `;

        // 繰上げ返済実行ポイントのマーカー
        const earlyMonth = Math.round(earlyYear * 12);
        const matchPt = earlyHistory.find(h => h.month === earlyMonth);
        if (matchPt) {
            const mx = getX(matchPt.month);
            const my = getY(matchPt.balance);
            svgContent += `
                <circle cx="${mx}" cy="${my}" r="4.5" fill="#059669" stroke="#ffffff" stroke-width="2" />
                <text x="${mx}" y="${my - 8}" font-size="9" font-weight="bold" fill="#059669" text-anchor="middle">⚡ 繰上げ実行</text>
            `;
        }
    }

    svg.innerHTML = svgContent;
}

// ==========================================
// 5. 年次返済スケジュールのレンダリング
// ==========================================
function renderYearlySchedule(baseHistory, earlyHistory) {
    const tbody = document.getElementById('yearlyScheduleBody');
    if (!tbody) return;

    const hist = (earlyHistory && earlyHistory.length > 0) ? earlyHistory : baseHistory;
    if (!hist || hist.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">データがありません</td></tr>';
        return;
    }

    let rowsHtml = '';
    const totalYears = Math.ceil(hist.length / 12);

    for (let yr = 1; yr <= totalYears; yr++) {
        const startIdx = (yr - 1) * 12;
        const endIdx = Math.min(yr * 12, hist.length);
        const yearSlice = hist.slice(startIdx, endIdx);

        const yearPayment = yearSlice.reduce((sum, m) => sum + m.payment, 0);
        const yearInterest = yearSlice.reduce((sum, m) => sum + m.interest, 0);
        const yearLumpSum = yearSlice.reduce((sum, m) => sum + (m.lumpSum || 0), 0);
        const endBalance = yearSlice[yearSlice.length - 1].balance;

        const isEarlyYear = yearLumpSum > 0;
        const rowClass = isEarlyYear ? 'class="early-applied-row"' : '';

        rowsHtml += `
            <tr ${rowClass}>
                <td>${yr}年目</td>
                <td>${(yearPayment / 10000).toFixed(1)}万</td>
                <td>${(yearInterest / 10000).toFixed(1)}万</td>
                <td>${yearLumpSum > 0 ? `+${(yearLumpSum / 10000).toFixed(0)}万` : '-'}</td>
                <td><strong>${(endBalance / 10000).toFixed(1)}万</strong></td>
            </tr>
        `;
    }

    tbody.innerHTML = rowsHtml;
}

// ==========================================
// 6. メインUI更新処理
// ==========================================
let currentViewMode = 'base'; // 'base' or 'early'

function updateSimulator() {
    // --- 1. 収入と手取り ---
    const grossIncomeMan = parseFloat(document.getElementById('annualIncome').value) || 0;
    const currentSavingsMan = parseFloat(document.getElementById('currentSavings').value) || 0;
    const targetMonthlySavingsMan = parseFloat(document.getElementById('targetMonthlySavings').value) || 0;

    const netResult = calculateNetIncome(grossIncomeMan);
    const netAnnualMan = netResult.netAnnual / 10000;
    const netMonthlyMan = netResult.netMonthly / 10000;

    document.getElementById('previewNetAnnual').textContent = `約 ${netAnnualMan.toFixed(1)} 万円`;
    document.getElementById('previewNetMonthly').textContent = `約 ${netMonthlyMan.toFixed(1)} 万円`;
    document.getElementById('resNetIncome').textContent = netMonthlyMan.toFixed(1);

    // --- 2. 生活費合計 ---
    const expenseIds = ['costRent', 'costUtility', 'costFood', 'costMobile', 'costWifi', 'costSocial', 'costMisc'];
    let totalLivingMan = 0;
    expenseIds.forEach(id => {
        totalLivingMan += parseFloat(document.getElementById(id).value) || 0;
    });
    document.getElementById('totalLivingCostDisplay').textContent = `${totalLivingMan.toFixed(1)} 万円`;
    document.getElementById('resLivingCost').textContent = `${totalLivingMan.toFixed(1)} 万円`;

    // --- 3. 3年次別借入条件 ---
    const tranches = [
        {
            amount: (parseFloat(document.getElementById('loanAmount1').value) || 0) * 10000,
            rate: parseFloat(document.getElementById('interestRate1').value) || 0
        },
        {
            amount: (parseFloat(document.getElementById('loanAmount2').value) || 0) * 10000,
            rate: parseFloat(document.getElementById('interestRate2').value) || 0
        },
        {
            amount: (parseFloat(document.getElementById('loanAmount3').value) || 0) * 10000,
            rate: parseFloat(document.getElementById('interestRate3').value) || 0
        }
    ];

    const totalLoanAmountYen = tranches.reduce((sum, t) => sum + t.amount, 0);
    const totalLoanAmountMan = totalLoanAmountYen / 10000;

    let avgRate = 0;
    if (totalLoanAmountYen > 0) {
        const weightedRateSum = tranches.reduce((sum, t) => sum + (t.amount * t.rate), 0);
        avgRate = weightedRateSum / totalLoanAmountYen;
    }

    document.getElementById('totalLoanAmountDisplay').textContent = `${totalLoanAmountMan.toFixed(1)} 万円`;
    document.getElementById('avgInterestRateDisplay').textContent = `${avgRate.toFixed(2)} %`;
    document.getElementById('resLoanAmount').textContent = `${totalLoanAmountMan.toFixed(1)} 万円`;

    // --- 4. 返済モードと繰上げ返済 ---
    const calcMode = document.querySelector('input[name="calcMode"]:checked').value;
    const repaymentYears = parseFloat(document.getElementById('repaymentYears').value) || 15;
    const customMonthlyPaymentYen = (parseFloat(document.getElementById('customMonthlyPayment').value) || 3) * 10000;

    const enableEarly = document.getElementById('enableEarlyRepayment').checked;
    const earlyTypeElem = document.querySelector('input[name="earlyType"]:checked');
    const earlyType = earlyTypeElem ? earlyTypeElem.value : 'shorten';
    const earlyRepaymentYear = parseFloat(document.getElementById('earlyRepaymentYear').value) || 3;
    const earlyRepaymentAmountMan = parseFloat(document.getElementById('earlyRepaymentAmount').value) || 100;
    const earlyRepaymentAmountYen = earlyRepaymentAmountMan * 10000;

    // 繰上げ返済のアドバイス表示
    const earlyAdviceBox = document.getElementById('earlyAdviceBox');
    const expectedSavingsAtYear = currentSavingsMan + (targetMonthlySavingsMan * 12 * earlyRepaymentYear);
    if (expectedSavingsAtYear < earlyRepaymentAmountMan) {
        earlyAdviceBox.innerHTML = `⚠️ <span style="color:var(--danger-dark); font-weight:bold;">貯蓄不足に注意:</span> ${earlyRepaymentYear}年後の想定貯金（約${expectedSavingsAtYear.toFixed(0)}万円）に対し、繰上げ返済額（${earlyRepaymentAmountMan}万円）が上回っています。`;
    } else {
        earlyAdviceBox.innerHTML = `💡 <span style="color:var(--success-dark); font-weight:bold;">貯蓄計画と両立可能:</span> ${earlyRepaymentYear}年後の想定貯金（約${expectedSavingsAtYear.toFixed(0)}万円）から無理なく拠出可能です。高金利トランチ（3年目等）から優先充当されます。`;
    }

    const earlyRepaymentConfig = {
        enabled: enableEarly,
        type: earlyType,
        year: earlyRepaymentYear,
        amount: earlyRepaymentAmountYen
    };

    const sim = simulateLoans(tranches, repaymentYears, customMonthlyPaymentYen, calcMode, earlyRepaymentConfig);

    if (!sim) return;
    if (sim.error) {
        alert(sim.error);
        return;
    }

    // --- 5. 繰上げ返済カード＆比較の更新 ---
    const earlyCard = document.getElementById('earlyEffectCard');
    const tabEarly = document.getElementById('tabViewEarly');
    const er = sim.earlyResult;

    const baseMonthlyPaymentYen = sim.baseMonthlyPayment;
    const baseMonthlyLoanMan = baseMonthlyPaymentYen / 10000;
    const baseTotalInterestMan = sim.baseTotalInterest / 10000;
    const baseTotalPaymentMan = sim.baseTotalPayment / 10000;

    const baseYears = Math.floor(sim.baseTotalMonths / 12);
    const baseRemainMonths = sim.baseTotalMonths % 12;

    if (enableEarly && er && !er.error) {
        earlyCard.style.display = 'block';
        tabEarly.style.display = 'block';

        const newYears = Math.floor(er.newTotalMonths / 12);
        const newRemainMonths = er.newTotalMonths % 12;
        const sYears = Math.floor(er.shortenedMonths / 12);
        const sMonths = er.shortenedMonths % 12;

        const newMonthlyPaymentYen = er.newMonthlyPayment;
        const newMonthlyLoanMan = newMonthlyPaymentYen / 10000;

        document.getElementById('cmpOrigPeriod').textContent = `${baseYears}年${baseRemainMonths}ヶ月`;
        document.getElementById('cmpNewPeriod').textContent = `${newYears}年${newRemainMonths}ヶ月`;

        document.getElementById('cmpOrigMonthly').textContent = `${(baseMonthlyPaymentYen / 10000).toFixed(2)} 万円`;
        document.getElementById('cmpNewMonthly').textContent = `${(newMonthlyPaymentYen / 10000).toFixed(2)} 万円`;

        document.getElementById('cmpOrigInterest').textContent = `${baseTotalInterestMan.toFixed(1)} 万円`;
        document.getElementById('cmpNewInterest').textContent = `${(er.newTotalInterest / 10000).toFixed(1)} 万円`;

        document.getElementById('cmpOrigTotal').textContent = `${baseTotalPaymentMan.toFixed(1)} 万円`;
        document.getElementById('cmpNewTotal').textContent = `${(er.newTotalPayment / 10000).toFixed(1)} 万円`;

        document.getElementById('resSavedInterest').textContent = `約 ${(er.savedInterest / 10000).toFixed(1)} 万円 おトク`;

        if (er.type === 'reduce') {
            document.getElementById('earlyEffectTitle').textContent = '💡 繰上げ返済（返済額軽減型）の効果比較';
            document.getElementById('lblShortenedOrReduced').textContent = '繰上げ後の月々軽減額:';
            document.getElementById('resShortenedTime').textContent = `月々 -${Math.round(er.reducedMonthlyPayment).toLocaleString()} 円 軽減！`;
            document.getElementById('resShortenedTime').className = 'text-success';
        } else {
            document.getElementById('earlyEffectTitle').textContent = '💡 繰上げ返済（期間短縮型）の効果比較';
            document.getElementById('lblShortenedOrReduced').textContent = '返済期間の短縮効果:';
            document.getElementById('resShortenedTime').textContent = `${sYears} 年 ${sMonths} ヶ月 短縮！`;
            document.getElementById('resShortenedTime').className = 'text-primary';
        }
    } else {
        earlyCard.style.display = 'none';
        tabEarly.style.display = 'none';
        currentViewMode = 'base';
    }

    // --- 6. 現在の表示プラン（通常返済 vs 繰上げ返済）に応じた収支・判定の更新 ---
    const isShowingEarly = currentViewMode === 'early' && enableEarly && er && !er.error;

    // タブの見た目更新
    const tabViewBase = document.getElementById('tabViewBase');
    const tabViewEarly = document.getElementById('tabViewEarly');
    if (isShowingEarly) {
        tabViewBase.classList.remove('active');
        tabViewEarly.classList.add('active', 'early-active');
        document.getElementById('judgePlanLabel').textContent = '将来の生活安心度診断（⚡ 繰上げ返済プラン適用後）';
        document.getElementById('balancePlanBadge').textContent = '繰上げ後';
    } else {
        tabViewBase.classList.add('active');
        tabViewEarly.classList.remove('active', 'early-active');
        document.getElementById('judgePlanLabel').textContent = '将来の生活安心度診断（通常返済プラン）';
        document.getElementById('balancePlanBadge').textContent = '通常時';
    }

    // 表示に使う月々返済額と総支払額
    let activeMonthlyLoanMan = baseMonthlyLoanMan;
    let activeMonthlyPaymentYen = baseMonthlyPaymentYen;
    let activeTotalInterestMan = baseTotalInterestMan;
    let activeTotalPaymentMan = baseTotalPaymentMan;

    if (isShowingEarly) {
        activeMonthlyLoanMan = er.newMonthlyPayment / 10000;
        activeMonthlyPaymentYen = er.newMonthlyPayment;
        activeTotalInterestMan = er.newTotalInterest / 10000;
        activeTotalPaymentMan = er.newTotalPayment / 10000;
    }

    document.getElementById('resMonthlyPaymentVal').textContent = `${Math.round(activeMonthlyPaymentYen).toLocaleString()} 円`;
    document.getElementById('resMonthlyLoan').textContent = `${activeMonthlyLoanMan.toFixed(1)} 万円`;
    document.getElementById('resTotalInterestVal').textContent = `${activeTotalInterestMan.toFixed(1)} 万円`;
    document.getElementById('resTotalPaymentVal').textContent = `${activeTotalPaymentMan.toFixed(1)} 万円`;
    document.getElementById('resSavings').textContent = `${targetMonthlySavingsMan.toFixed(1)} 万円`;

    // 収支計算
    const totalOutflowMan = totalLivingMan + targetMonthlySavingsMan + activeMonthlyLoanMan;
    const freeMoneyMan = netMonthlyMan - totalOutflowMan;

    const freeMoneyElem = document.getElementById('resFreeMoney');
    if (freeMoneyMan >= 0) {
        freeMoneyElem.textContent = `+${freeMoneyMan.toFixed(1)} 万円`;
        freeMoneyElem.className = 'text-primary';
    } else {
        freeMoneyElem.textContent = `${freeMoneyMan.toFixed(1)} 万円 (赤字)`;
        freeMoneyElem.className = 'text-danger';
    }

    // 返済負担率 DTI
    const dtiRatio = netMonthlyMan > 0 ? (activeMonthlyLoanMan / netMonthlyMan) * 100 : 0;
    document.getElementById('resDtiRatio').textContent = `${dtiRatio.toFixed(1)}%`;

    const dtiComment = document.getElementById('dtiComment');
    if (dtiRatio <= 15) {
        dtiComment.textContent = '（とても安全な負担率です）';
    } else if (dtiRatio <= 25) {
        dtiComment.textContent = '（一般的な許容範囲内です）';
    } else {
        dtiComment.textContent = '（返済負担が重く注意が必要です）';
    }

    // 総合判定バッジ
    const statusBadge = document.getElementById('statusBadge');
    const judgeTitle = document.getElementById('judgeTitle');
    const judgeDetail = document.getElementById('judgeDetail');
    const judgeCard = document.getElementById('judgeCard');

    statusBadge.className = 'status-badge';

    if (freeMoneyMan < 0) {
        statusBadge.textContent = '危険（毎月赤字）';
        statusBadge.classList.add('status-danger');
        judgeCard.style.borderColor = 'var(--danger)';
        judgeTitle.textContent = '⚠️ 毎月の収支が赤字になるリスクが高いです';
        judgeDetail.textContent = `手取りに対して生活費と返済額が上回っており、毎月約 ${Math.abs(freeMoneyMan).toFixed(1)} 万円の赤字です。借入額の抑制や返済期間の延長、家賃などの固定費見直しを検討してください。`;
    } else if (freeMoneyMan < 1.5 || dtiRatio > 25) {
        statusBadge.textContent = '要注意（ゆとり少）';
        statusBadge.classList.add('status-warning');
        judgeCard.style.borderColor = 'var(--warning)';
        judgeTitle.textContent = '⚠️ 返済は可能ですが、生活のゆとりが少なめです';
        judgeDetail.textContent = `手取りの ${dtiRatio.toFixed(1)}% が返済に充てられ、毎月の自由資金は ${freeMoneyMan.toFixed(1)} 万円です。予備の貯金を崩さないよう計画的な支出を心がけましょう。`;
    } else {
        statusBadge.textContent = '安心（無理のない計画）';
        statusBadge.classList.add('status-safe');
        judgeCard.style.borderColor = 'var(--success)';
        if (isShowingEarly && er.type === 'shorten') {
            judgeTitle.textContent = `🚀 繰上げ返済で ${Math.floor(er.shortenedMonths/12)}年${er.shortenedMonths%12}ヶ月 早期完済！`;
            judgeDetail.textContent = `繰上げ返済により利息を約 ${(er.savedInterest/10000).toFixed(1)} 万円節約でき、${Math.floor(er.newTotalMonths/12)}年${er.newTotalMonths%12}ヶ月で完済します。早期完済後は毎月の返済分（${activeMonthlyLoanMan.toFixed(1)}万円）がまるまる自由資金・資産形成に回ります。`;
        } else if (isShowingEarly && er.type === 'reduce') {
            judgeTitle.textContent = `💰 繰上げ返済で毎月の返済が -${Math.round(er.reducedMonthlyPayment).toLocaleString()} 円 軽くなります！`;
            judgeDetail.textContent = `繰上げ返済によって月々の支払いが安くなり、毎月の自由資金が +${freeMoneyMan.toFixed(1)} 万円に拡大しました。生活のゆとりを確保しながら利息も約 ${(er.savedInterest/10000).toFixed(1)} 万円削減できます。`;
        } else {
            judgeTitle.textContent = '✅ 無理なく安定して返済できる計画です';
            judgeDetail.textContent = `毎月 ${targetMonthlySavingsMan.toFixed(1)} 万円を貯金しながら、さらに約 ${freeMoneyMan.toFixed(1)} 万円の自由資金が残ります。3回分割借入（合計 ${totalLoanAmountMan.toFixed(0)}万円）の返済負担率も ${dtiRatio.toFixed(1)}% と適正です。`;
        }
    }

    // --- 7. スタックバーメーター ---
    const segLiving = document.getElementById('segLiving');
    const segSavings = document.getElementById('segSavings');
    const segLoan = document.getElementById('segLoan');
    const segRemain = document.getElementById('segRemain');

    const totalDenom = Math.max(netMonthlyMan, totalOutflowMan);
    if (totalDenom > 0) {
        const pctLiving = (totalLivingMan / totalDenom) * 100;
        const pctSavings = (targetMonthlySavingsMan / totalDenom) * 100;
        const pctLoan = (activeMonthlyLoanMan / totalDenom) * 100;
        const pctRemain = Math.max(0, (freeMoneyMan / totalDenom) * 100);

        segLiving.style.width = `${pctLiving}%`;
        segLiving.textContent = pctLiving > 12 ? `生活費 ${totalLivingMan.toFixed(1)}万` : '';

        segSavings.style.width = `${pctSavings}%`;
        segSavings.textContent = pctSavings > 12 ? `貯金 ${targetMonthlySavingsMan.toFixed(1)}万` : '';

        segLoan.style.width = `${pctLoan}%`;
        segLoan.textContent = pctLoan > 12 ? `返済 ${activeMonthlyLoanMan.toFixed(1)}万` : '';

        segRemain.style.width = `${pctRemain}%`;
        segRemain.textContent = pctRemain > 12 ? `余剰 ${freeMoneyMan.toFixed(1)}万` : '';
        segRemain.style.display = freeMoneyMan > 0 ? 'flex' : 'none';
    }

    // --- 8. SVGチャート & 年次スケジュールの更新 ---
    const earlyHist = (enableEarly && er && !er.error) ? er.history : null;
    renderLoanChart(sim.baseHistory, earlyHist, sim.totalPrincipal, earlyRepaymentYear);
    renderYearlySchedule(sim.baseHistory, earlyHist);
}

// ==========================================
// イベントリスナー設定
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 返済方式切り替え（年数指定 vs 返済額指定）
    const modeRadios = document.querySelectorAll('input[name="calcMode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'byYears') {
                document.getElementById('groupRepaymentYears').style.display = 'block';
                document.getElementById('groupCustomMonthly').style.display = 'none';
            } else {
                document.getElementById('groupRepaymentYears').style.display = 'none';
                document.getElementById('groupCustomMonthly').style.display = 'block';
            }
            updateSimulator();
        });
    });

    // 繰上げ返済トグル
    const earlyToggle = document.getElementById('enableEarlyRepayment');
    earlyToggle.addEventListener('change', (e) => {
        document.getElementById('earlyRepaymentBox').style.display = e.target.checked ? 'block' : 'none';
        if (!e.target.checked) currentViewMode = 'base';
        updateSimulator();
    });

    // 繰上げ返済方式（期間短縮 vs 返済額軽減）
    const earlyTypeRadios = document.querySelectorAll('input[name="earlyType"]');
    earlyTypeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            updateSimulator();
        });
    });

    // 結果表示モードタブ（通常プラン vs 繰上げプラン）
    document.getElementById('tabViewBase').addEventListener('click', () => {
        currentViewMode = 'base';
        updateSimulator();
    });

    document.getElementById('tabViewEarly').addEventListener('click', () => {
        currentViewMode = 'early';
        updateSimulator();
    });

    // 全てのinput変更時にリアルタイム更新
    const allInputs = document.querySelectorAll('input');
    allInputs.forEach(input => {
        input.addEventListener('input', updateSimulator);
    });

    // ボタンクリックでも更新＆スクロール
    document.getElementById('calculateBtn').addEventListener('click', () => {
        updateSimulator();
        document.getElementById('judgeCard').scrollIntoView({ behavior: 'smooth' });
    });

    // 初回実行
    updateSimulator();
});
