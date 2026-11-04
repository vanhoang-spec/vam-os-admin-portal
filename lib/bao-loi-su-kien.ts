/**
 * Tên sự kiện trình duyệt để nút "Báo lỗi" trên thanh trên cùng gọi hộp báo lỗi. Hộp (fixed, che cả trang) không đặt
 * được trong thanh trên cùng vì thanh đó có backdrop-blur: phần tử có backdrop-filter thành khung chứa của mọi phần tử
 * fixed bên trong, hộp sẽ co lại bằng chiều cao thanh. Nên nút ở thanh, hộp ở cuối AppShell, nối với nhau bằng sự kiện.
 */
export const MO_FORM_BAO_LOI = "vam:mo-form-bao-loi";
