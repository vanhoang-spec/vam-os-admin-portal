/** Hướng dẫn phản ánh kế hoạch chủ chương trình chốt 27/09, không phải mẫu email đã gửi. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {DAILY_EMAIL_LIMIT,DISPATCH_RESERVE} from '@/lib/mentee-invite-dispatch-core';
import {HOTLINE_ZALO} from '@/lib/mentee-interview-core';
const root=join(__dirname,'..');
const html=readFileSync(join(root,'docs/huong-dan/HUONG_DAN_PHONG_VAN_MENTEE_GIAI_DOAN_1.html'),'utf8');
const text=html.replace(/<style[\s\S]*?<\/style>/i,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
describe('Kế hoạch Support rà soát trước đợt gửi 28/09',()=>{
  it('chờ địa chỉ chính xác để đưa vào email, không gửi nội dung chờ địa điểm',()=>{
    expect(text).toContain('Chờ địa chỉ chính xác ngày 28/09');
    expect(text).toContain('Địa chỉ: [Địa chỉ đầy đủ được chốt ngày 28/09]');
    expect(text).toContain('Không gửi bản còn ô trống');
  });
  it('chủ chương trình giao hệ thống gửi; Support không bấm gửi trong CRM',()=>{
    expect(text).toContain('chủ chương trình sẽ giao lệnh cho hệ thống gửi đồng loạt');
    expect(text).toContain('Support không cần vào CRM để bấm gửi email');
    expect(text).not.toContain('rồi bấm Gửi thư mời chọn ca');
    expect(text).not.toContain('Bấm lại cho tới khi');
  });
  it('phân biệt kế hoạch với trạng thái đã triển khai hoặc đã lên lịch',()=>{
    expect(text).toContain('chưa triển khai production');
    expect(text).toContain('chưa đặt lịch tự gửi');
    expect(text).toContain('Bản dự kiến — chưa gửi');
  });
  it('không hứa vượt hạn mức email hiện có',()=>{
    expect(text).toContain(`${DAILY_EMAIL_LIMIT} thư mỗi 24 giờ`);
    expect(text).toContain(`chừa ${DISPATCH_RESERVE} thư`);
    expect(text).toContain('có thể phải chia lô hoặc chờ hạn mức');
  });
  it('giữ 25 người mỗi ca, 5 phòng x 5 mentor và hạn đăng ký',()=>{
    expect(text).toContain('5 phòng × 5 mentor mỗi phòng = 25 mentor cùng lúc');
    expect(text).toContain('24 ca');expect(text).toContain('600 chỗ');
    expect(text).toContain('23:59 ngày 30/09/2026');
    expect(text).toContain('ca đủ chỗ sẽ không chọn được nữa');
  });
  it('QR ngay tại trang, không email xác nhận lần hai; kết quả gửi đợt riêng',()=>{
    expect(text).toContain('xác nhận và QR hiện ngay trên trang');
    expect(text).toContain('Không gửi thêm email xác nhận');
    expect(text).toContain('chưa gửi email đậu/rớt');
  });
  it('giữ hướng dẫn check-in SĐT, phân bàn, chấm, nhận và sửa kết quả',()=>{
    for(const phrase of ['số điện thoại','Lưu phân bàn','5 tiêu chí hiện tại','Nhận làm mentee của tôi','Sửa kết quả / lựa chọn mentee','hoàn suất']) expect(text).toContain(phrase);
    expect(text).toContain(HOTLINE_ZALO);
  });
  it('PDF vẫn đủ hai trang',()=>{
    const pdf=readFileSync(join(root,'docs/huong-dan/HUONG_DAN_PHONG_VAN_MENTEE_GIAI_DOAN_1.pdf'),'latin1');
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(2);
  });
});
