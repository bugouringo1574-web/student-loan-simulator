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
// 2. 単一ローンの月々返済額計算 (元利均等)
// ==========================================
function calcTrancheMonthlyPMT(principal, annualRatePct, months) {
    if (principal <= 0 || months <= 0) return 0;
    const r = (annualRatePct / 100) / 12;
    if (r === 0) return principal / months;
    return principal * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

// ==========================================
// 3. 3回分割借入ローンの詳細シミュレーション
// ==========================================
function simulate3TrancheLoan(tranches, repaymentYears, customMonthlyPaymentYen, calcMode, earlyRepayment) {
    const totalPrincipal = tranches.reduce((sum, t) => sum + t.amount, 0);
    if (totalPrincipal <= 0) {
        return {
            totalPrincipal: 0,
            baseMonthlyPayment: 0,
            baseTotalMonths: 0,
            baseTotalInterest: 0,
            baseTotalPayment: 0,
            earlyResult: null
        };
    }

    let baseMonthlyPayment = 0;
    let baseTotalMonths = 0;
    let tranchesPMT = [];

    if (calcMode === 'byYears') {
        baseTotalMonths = Math.max(1, Math.round(repaymentYears * 12));
        tranchesPMT = tranches.map(t => calcTrancheMonthlyPMT(t.amount, t.rate, baseTotalMonths));
        baseMonthlyPayment = tranchesPMT.reduce((a, b) => a + b, 0);
    } else {
        baseMonthlyPayment = customMonthlyPaymentYen;
        // 月々返済額から必要月数をシミュレート
        const minMonthlyInterest = tranches.reduce((sum, t) => sum + (t.amount * (t.rate / 100 / 12)), 0);
        if (baseMonthlyPayment <= minMonthlyInterest) {
            return { error: '月々の希望返済額が金利利息を下回っているため完済できません。返済額を増やしてください。' };
        }
        // 各年次の比率に応じて月数を概算
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
        tranchesPMT = tranches.map(t => calcTrancheMonthlyPMT(t.amount, t.rate, baseTotalMonths));
        baseMonthlyPayment = tranchesPMT.reduce((a, b) => a + b, 0);
    }

    // --- 通常返済（繰上げなし）の月次シミュレーション ---
    let simTranches = tranches.map((t, idx) => ({
        principal: t.amount,
        rate: t.rate,
        balance: t.amount,
        pmt: tranchesPMT[idx]
    }));

    let baseTotalInterest = 0;
    let baseActualMonths = 0;

    for (let m = 1; m <= 600; m++) {
        let allZero = true;
        let monthlyInterestSum = 0;

        simTranches.forEach(t => {
            if (t.balance > 0.01) {
                allZero = false;
                const r = (t.rate / 100) / 12;
                const interest = t.balance * r;
                monthlyInterestSum += interest;
                const principalPart = Math.min(t.balance, t.pmt - interest);
                t.balance -= principalPart;
                if (t.balance < 0.01) t.balance = 0;
            }
        });

        if (allZero) break;
        baseTotalInterest += monthlyInterestSum;
        baseActualMonths = m;
    }

    const baseTotalPayment = totalPrincipal + baseTotalInterest;

    // --- 繰上げ返済ありのシミュレーション ---
    let earlyResult = null;
    if (earlyRepayment && earlyRepayment.enabled && earlyRepayment.amount > 0) {
        const earlyMonth = Math.round(earlyRepayment.year * 12);
        
        if (earlyMonth >= baseActualMonths) {
            earlyResult = { error: '繰上げ返済の年数は完済予定より前の年数を指定してください。' };
        } else {
            let earlyTranches = tranches.map((t, idx) => ({
                id: idx,
                principal: t.amount,
                rate: t.rate,
                balance: t.amount,
                pmt: tranchesPMT[idx]
            }));

            let earlyTotalInterest = 0;
            let earlyActualMonths = 0;
            let totalPaidSoFar = 0;

            // 1ヶ月目 〜 earlyMonth まで通常返済
            for (let m = 1; m <= earlyMonth; m++) {
                let allZero = true;
                simTranches.forEach(t => {
                    if (t.balance > 0.01) {
                        allZero = false;
                        const r = (t.rate / 100) / 12;
                        const interest = t.balance * r;
                        earlyTotalInterest += interest;
                        const principalPart = Math.min(t.balance, t.pmt - interest);
                        t.balance -= principalPart;
                        totalPaidSoFar += (interest + principalPart);
                        if (t.balance < 0.01) t.balance = 0;
                    }
                });
                earlyActualMonths = m;
                if (allZero) break;
            }

            // earlyMonth 時点で繰上げ返済を実行（高金利のローンから優先して返済）
            let lumpSum = earlyRepayment.amount;
            // 金利の高い順にソート
            let sortedByRate = [...earlyTranches].sort((a, b) => b.rate - a.rate);
            
            sortedByRate.forEach(t => {
                if (lumpSum > 0 && t.balance > 0) {
                    const pay = Math.min(t.balance, lumpSum);
                    t.balance -= pay;
                    lumpSum -= pay;
                }
            });

            // 残りの期間をシミュレーション（期間短縮型: 各トランチのPMTを維持し、完済したものから抜ける）
            for (let m = earlyMonth + 1; m <= 600; m++) {
                let allZero = true;
                earlyTranches.forEach(t => {
                    if (t.balance > 0.01) {
                        allZero = false;
                        const r = (t.rate / 100) / 12;
                        const interest = t.balance * r;
                        earlyTotalInterest += interest;
                        const principalPart = Math.min(t.balance, t.pmt - interest);
                        t.balance -= principalPart;
                        if (t.balance < 0.01) t.balance = 0;
                    }
                });

                if (allZero) break;
                earlyActualMonths = m;
            }

            const earlyTotalPayment = totalPrincipal + earlyTotalInterest;
            const savedInterest = Math.max(0, baseTotalInterest - earlyTotalInterest);
            const shortenedMonths = Math.max(0, baseActualMonths - earlyActualMonths);

            earlyResult = {
                newTotalMonths: earlyActualMonths,
                newTotalInterest: earlyTotalInterest,
                newTotalPayment: earlyTotalPayment,
                savedInterest: savedInterest,
                shortenedMonths: shortenedMonths
            };
        }
    }

    return {
        totalPrincipal,
        baseMonthlyPayment,
        baseTotalMonths: baseActualMonths,
        baseTotalInterest,
        baseTotalPayment,
        earlyResult
    };
}

// ==========================================
// 4. メインUI更新処理
// ==========================================
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
    const earlyRepaymentYear = parseFloat(document.getElementById('earlyRepaymentYear').value) || 3;
    const earlyRepaymentAmountYen = (parseFloat(document.getElementById('earlyRepaymentAmount').value) || 50) * 10000;

    const earlyRepaymentConfig = {
        enabled: enableEarly,
        year: earlyRepaymentYear,
        amount: earlyRepaymentAmountYen
    };

    const sim = simulate3TrancheLoan(tranches, repaymentYears, customMonthlyPaymentYen, calcMode, earlyRepaymentConfig);

    if (sim.error) {
        alert(sim.error);
        return;
    }

    // 通常時の結果反映
    const monthlyPaymentYen = sim.baseMonthlyPayment;
    const monthlyLoanMan = monthlyPaymentYen / 10000;
    const totalInterestMan = sim.baseTotalInterest / 10000;
    const totalPaymentMan = sim.baseTotalPayment / 10000;

    const baseYears = Math.floor(sim.baseTotalMonths / 12);
    const baseRemainMonths = sim.baseTotalMonths % 12;
    const basePeriodStr = `${baseYears}年${baseRemainMonths}ヶ月 (${sim.baseTotalMonths}回)`;

    document.getElementById('resMonthlyPaymentVal').textContent = `${Math.round(monthlyPaymentYen).toLocaleString()} 円`;
    document.getElementById('resMonthlyLoan').textContent = `${monthlyLoanMan.toFixed(1)} 万円`;
    document.getElementById('resTotalInterestVal').textContent = `${totalInterestMan.toFixed(1)} 万円`;
    document.getElementById('resTotalPaymentVal').textContent = `${totalPaymentMan.toFixed(1)} 万円`;
    document.getElementById('resSavings').textContent = `${targetMonthlySavingsMan.toFixed(1)} 万円`;

    // --- 5. 繰上げ返済カードの更新 ---
    const earlyCard = document.getElementById('earlyEffectCard');
    if (enableEarly && sim.earlyResult && !sim.earlyResult.error) {
        earlyCard.style.display = 'block';
        const er = sim.earlyResult;

        const newYears = Math.floor(er.newTotalMonths / 12);
        const newRemainMonths = er.newTotalMonths % 12;

        const sYears = Math.floor(er.shortenedMonths / 12);
        const sMonths = er.shortenedMonths % 12;

        document.getElementById('cmpOrigPeriod').textContent = `${baseYears}年${baseRemainMonths}ヶ月`;
        document.getElementById('cmpNewPeriod').textContent = `${newYears}年${newRemainMonths}ヶ月`;

        document.getElementById('cmpOrigInterest').textContent = `${totalInterestMan.toFixed(1)} 万円`;
        document.getElementById('cmpNewInterest').textContent = `${(er.newTotalInterest / 10000).toFixed(1)} 万円`;

        document.getElementById('cmpOrigTotal').textContent = `${totalPaymentMan.toFixed(1)} 万円`;
        document.getElementById('cmpNewTotal').textContent = `${(er.newTotalPayment / 10000).toFixed(1)} 万円`;

        document.getElementById('resSavedInterest').textContent = `約 ${(er.savedInterest / 10000).toFixed(1)} 万円 おトク`;
        document.getElementById('resShortenedTime').textContent = `${sYears}年 ${sMonths}ヶ月 短縮！`;
    } else {
        earlyCard.style.display = 'none';
    }

    // --- 6. 収支バランスと安心度判定 ---
    const totalOutflowMan = totalLivingMan + targetMonthlySavingsMan + monthlyLoanMan;
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
    const dtiRatio = netMonthlyMan > 0 ? (monthlyLoanMan / netMonthlyMan) * 100 : 0;
    document.getElementById('resDtiRatio').textContent = `${dtiRatio.toFixed(1)}%`;

    const dtiComment = document.getElementById('dtiComment');
    if (dtiRatio <= 15) {
        dtiComment.textContent = '（とても安全な負担率です）';
    } else if (dtiRatio <= 25) {
        dtiComment.textContent = '（一般的な許容範囲内です）';
    } else {
        dtiComment.textContent = '（返済負担が重く注意が必要です）';
    }

    // 総合判定
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
        judgeDetail.textContent = `手取りの ${dtiRatio.toFixed(1)}% が返済に充てられ、毎月の自由資金は ${freeMoneyMan.toFixed(1)} 万円です。予備の貯金（現在 ${currentSavingsMan}万円）を崩さないよう計画的な支出を心がけましょう。`;
    } else {
        statusBadge.textContent = '安心（無理のない計画）';
        statusBadge.classList.add('status-safe');
        judgeCard.style.borderColor = 'var(--success)';
        judgeTitle.textContent = '✅ 無理なく安定して返済できる計画です';
        judgeDetail.textContent = `毎月 ${targetMonthlySavingsMan.toFixed(1)} 万円を貯金しながら、さらに約 ${freeMoneyMan.toFixed(1)} 万円の自由資金が残ります。3回分割借入（合計 ${totalLoanAmountMan.toFixed(0)}万円）の返済負担率も ${dtiRatio.toFixed(1)}% と適正です。`;
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
        const pctLoan = (monthlyLoanMan / totalDenom) * 100;
        const pctRemain = Math.max(0, (freeMoneyMan / totalDenom) * 100);

        segLiving.style.width = `${pctLiving}%`;
        segLiving.textContent = pctLiving > 12 ? `生活費 ${totalLivingMan.toFixed(1)}万` : '';

        segSavings.style.width = `${pctSavings}%`;
        segSavings.textContent = pctSavings > 12 ? `貯金 ${targetMonthlySavingsMan.toFixed(1)}万` : '';

        segLoan.style.width = `${pctLoan}%`;
        segLoan.textContent = pctLoan > 12 ? `返済 ${monthlyLoanMan.toFixed(1)}万` : '';

        segRemain.style.width = `${pctRemain}%`;
        segRemain.textContent = pctRemain > 12 ? `余剰 ${freeMoneyMan.toFixed(1)}万` : '';
        segRemain.style.display = freeMoneyMan > 0 ? 'flex' : 'none';
    }
}

// ==========================================
// イベントリスナー設定
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 返済方式切り替え
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
